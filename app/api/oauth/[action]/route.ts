// app/api/oauth/[action]/route.ts
// 授权服务器的三个端点：authorize / token / register
//
// 为什么新增这个文件：原先 app/api/oauth/ 下的 authorize.js、token.js、register.js
// 用的是 Pages Router 的 `export default handler(req, res)` 写法，放在 app/ 目录里
// Next.js 不会识别成路由，所以线上 /api/oauth/* 全部返回 404。
// 这里用 App Router 的写法重新实现同样的流程。

import { createHash, randomBytes } from "node:crypto";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function randomString() {
  return randomBytes(24).toString("hex");
}

type CodeRecord = {
  client_id: string;
  redirect_uri: string;
  code_challenge?: string;
  expiresAt: number;
};

// 简易内存存储。
// 注意：Serverless 上不同请求可能落到不同实例，内存不共享，
// 所以授权码可能在 token 那一步“找不到”。要跑稳需要接 Redis / Vercel KV。
function getStore() {
  const g = globalThis as unknown as { __oauthStore?: OAuthStore };
  if (!g.__oauthStore) {
    g.__oauthStore = { codes: {}, tokens: {}, clients: {} };
  }
  return g.__oauthStore;
}

type OAuthStore = {
  codes: Record<string, CodeRecord>;
  tokens: Record<string, { client_id: string; expiresAt: number }>;
  clients: Record<string, { client_name: string; redirect_uris: string[] }>;
};

// PKCE S256：base64url(sha256(code_verifier))
function s256(verifier: string) {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

// 只允许 https 回跳地址，或本机调试用的 http://localhost
function isSafeRedirectUri(uri: string | null): uri is string {
  if (!uri) return false;
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

// GET /api/oauth/authorize —— 客户端把用户导向这里，我们发码并 302 回跳
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

  if (!isSafeRedirectUri(redirect_uri)) {
    return json({ error: "invalid_request", error_description: "redirect_uri 不合法" }, 400);
  }

  const store = getStore();
  const code = randomString();
  store.codes[code] = {
    client_id: client_id || "unknown",
    redirect_uri,
    code_challenge: code_challenge || undefined,
    expiresAt: Date.now() + 10 * 60 * 1000, // 授权码 10 分钟内有效
  };

  const target = new URL(redirect_uri);
  target.searchParams.set("code", code);
  if (state) target.searchParams.set("state", state);

  return new Response(null, { status: 302, headers: { Location: target.toString() } });
}

// POST /api/oauth/register 与 POST /api/oauth/token
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> }
) {
  const { action } = await context.params;
  const store = getStore();

  if (action === "register") {
    const body = (await request.json().catch(() => ({}))) as {
      client_name?: string;
      redirect_uris?: string[];
    };
    const client_id = randomString();
    const redirect_uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    store.clients[client_id] = { client_name: body.client_name || "unnamed", redirect_uris };

    return json(
      {
        client_id,
        client_name: store.clients[client_id].client_name,
        redirect_uris,
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201
    );
  }

  if (action === "token") {
    // mcp-remote / OAuth 客户端通常用表单编码提交，这里同时兼容 JSON
    let code = "";
    let client_id = "";
    let code_verifier = "";

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      code = String(form.get("code") || "");
      client_id = String(form.get("client_id") || "");
      code_verifier = String(form.get("code_verifier") || "");
    } else {
      const body = (await request.json().catch(() => ({}))) as Record<string, string>;
      code = body.code || "";
      client_id = body.client_id || "";
      code_verifier = body.code_verifier || "";
    }

    const record = store.codes[code];
    if (!record || record.expiresAt < Date.now()) {
      return json({ error: "invalid_grant", error_description: "授权码不存在或已过期" }, 400);
    }
    if (record.client_id !== client_id) {
      return json({ error: "invalid_grant", error_description: "client_id 不匹配" }, 400);
    }
    if (record.code_challenge) {
      if (!code_verifier) {
        return json({ error: "invalid_grant", error_description: "缺少 code_verifier" }, 400);
      }
      if (s256(code_verifier) !== record.code_challenge) {
        return json({ error: "invalid_grant", error_description: "PKCE 校验失败" }, 400);
      }
    }

    delete store.codes[code]; // 授权码一次性使用

    const access_token = randomString();
    store.tokens[access_token] = { client_id, expiresAt: Date.now() + 3600 * 1000 };

    return json({
      access_token,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "",
    });
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
