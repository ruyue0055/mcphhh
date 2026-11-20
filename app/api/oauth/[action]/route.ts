// app/api/oauth/[action]/route.ts
// 授权服务器三个端点：authorize / token / register
//
// 用签名令牌代替内存存储：Vercel 上 authorize 与 token 两次请求可能落到不同实例，
// 内存里的授权码会丢，导致 Gemini 授权中途失败。现在状态全签在令牌里，任何实例都能验。

import {
  ISSUER,
  issueAccessToken,
  issueCode,
  issueRefreshToken,
  isSafeRedirectUri,
  randomToken,
  readAccessToken,
  readCode,
  readRefreshToken,
  s256,
} from "../../../lib/oauth-core";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// GET /api/oauth/authorize
export async function GET(
  request: Request,
  context: { params: Promise<{ action: string }> }
) {
  const { action } = await context.params;
  if (action !== "authorize") return json({ error: "not_found" }, 404);

  const url = new URL(request.url);
  const client_id = url.searchParams.get("client_id");
  const redirect_uri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const code_challenge = url.searchParams.get("code_challenge");
  const challenge_method = url.searchParams.get("code_challenge_method") || "S256";

  if (!isSafeRedirectUri(redirect_uri)) {
    return json({ error: "invalid_request", error_description: "redirect_uri 不合法" }, 400);
  }
  if (challenge_method !== "S256") {
    return json({ error: "invalid_request", error_description: "只支持 S256" }, 400);
  }

  const code = issueCode({
    client_id: client_id || "anonymous",
    redirect_uri,
    code_challenge: code_challenge || undefined,
  });

  const target = new URL(redirect_uri);
  target.searchParams.set("code", code);
  if (state) target.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: { Location: target.toString() },
  });
}

// POST /api/oauth/register 与 POST /api/oauth/token
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> }
) {
  const { action } = await context.params;

  if (action === "register") {
    // 动态客户端注册（RFC 7591）：无需数据库，client_id 本身就是随机串。
    // 我们的 authorize 端点不强制校验 client_id 白名单，只做回跳地址合法性检查。
    const body = (await request.json().catch(() => ({}))) as {
      client_name?: string;
      redirect_uris?: string[];
    };
    const redirect_uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];

    return json(
      {
        client_id: randomToken(),
        client_name: body.client_name || "unnamed",
        redirect_uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        issuer: ISSUER,
      },
      201
    );
  }

  if (action === "token") {
    let code = "";
    let client_id = "";
    let code_verifier = "";
    let grant_type = "";
    let refresh_token_in = "";

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      grant_type = String(form.get("grant_type") || "");
      code = String(form.get("code") || "");
      client_id = String(form.get("client_id") || "");
      code_verifier = String(form.get("code_verifier") || "");
      refresh_token_in = String(form.get("refresh_token") || "");
    } else {
      const body = (await request.json().catch(() => ({}))) as Record<string, string>;
      grant_type = body.grant_type || "";
      code = body.code || "";
      client_id = body.client_id || "";
      code_verifier = body.code_verifier || "";
      refresh_token_in = body.refresh_token || "";
    }

    // 分支一：用刷新令牌续期（Gemini / Google 关联后会定期走这里）
    if (grant_type === "refresh_token") {
      const rt = readRefreshToken(refresh_token_in);
      if (!rt) {
        return json({ error: "invalid_grant", error_description: "刷新令牌无效或已过期" }, 400);
      }
      if (rt.cid !== client_id) {
        return json({ error: "invalid_grant", error_description: "client_id 不匹配" }, 400);
      }
      const renewed = issueAccessToken(rt.cid);
      return json({
        access_token: renewed.accessToken,
        token_type: "Bearer",
        expires_in: renewed.expiresIn,
        scope: "",
        // 滚动刷新：同时发一张新的刷新令牌，旧的那张在有效期内自然过期
        refresh_token: issueRefreshToken(rt.cid),
      });
    }

    // 分支二：授权码换令牌
    const record = readCode(code);
    if (!record) {
      return json({ error: "invalid_grant", error_description: "授权码无效或已过期" }, 400);
    }
    if (record.cid !== client_id) {
      return json({ error: "invalid_grant", error_description: "client_id 不匹配" }, 400);
    }
    if (record.cch) {
      if (!code_verifier) {
        return json({ error: "invalid_grant", error_description: "缺少 code_verifier" }, 400);
      }
      if (s256(code_verifier) !== record.cch) {
        return json({ error: "invalid_grant", error_description: "PKCE 校验失败" }, 400);
      }
    }

    const { accessToken, expiresIn } = issueAccessToken(record.cid);
    return json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope: "",
      // Google 的账号关联需要长期会话，响应里必须带 refresh_token，
      // 否则 Gemini 可能停在"必须关联账号"这一步
      refresh_token: issueRefreshToken(record.cid),
    });
  }

  if (action === "revoke") {
    // 无状态令牌无法真正撤销，按规范返回 200 表示已接受
    return new Response(null, { status: 200 });
  }

  return json({ error: "not_found" }, 404);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
