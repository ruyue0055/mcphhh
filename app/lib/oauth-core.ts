// app/lib/oauth-core.ts
// 授权流程的核心：把状态签进令牌里，而不是存在内存中。
//
// 为什么要这么做：Vercel 是 Serverless，authorize 和 token 两个请求很可能落到
// 不同实例上。用 global.xxx 内存存授权码，实例一换码就"查无此码"，
// Gemini 的授权就会中途失败。改成 HMAC 自包含签名令牌后，任何实例都能独立校验，
// 不需要 Redis / KV，也不需要额外注册任何服务。

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// 对外域名。部署到别的域名时改这一处即可（或设置 MCP_PUBLIC_URL 环境变量）。
export const ISSUER =
  process.env.MCP_PUBLIC_URL?.replace(/\/$/, "") || "https://mcphhh.vercel.app";

// 签名密钥：务必在 Vercel 环境变量里设置 OAUTH_TOKEN_SECRET。
// 没设置时用默认值也能跑通，但任何人都能伪造访问令牌，等于没有鉴权。
const SECRET = process.env.OAUTH_TOKEN_SECRET || "CHANGE-ME-set-OAUTH_TOKEN_SECRET-in-vercel";

const CODE_TTL_MS = 10 * 60 * 1000; // 授权码 10 分钟
const TOKEN_TTL_MS = 60 * 60 * 1000; // 访问令牌 1 小时
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 刷新令牌 30 天

export type CodePayload = {
  typ: "code";
  cid: string; // client_id
  rdi: string; // redirect_uri
  cch?: string; // code_challenge
  exp: number; // 过期时间戳(ms)
};

export type TokenPayload = {
  typ: "at";
  cid: string;
  exp: number;
};

export type RefreshPayload = {
  typ: "rt";
  cid: string;
  exp: number;
};

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hmac(data: string) {
  return b64url(createHmac("sha256", SECRET).update(data, "utf8").digest());
}

function sign(payload: object) {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${hmac(body)}`;
}

function verify<T>(token: string, expect: "code" | "at" | "rt"): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  // 定长比较，避免时序侧信道
  const expected = Buffer.from(hmac(body));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    ) as { typ: string; exp: number };
    if (payload.typ !== expect) return null;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload as T;
  } catch {
    return null;
  }
}

export function randomToken() {
  return randomBytes(24).toString("hex");
}

export function issueCode(input: { client_id: string; redirect_uri: string; code_challenge?: string }) {
  const payload: CodePayload = {
    typ: "code",
    cid: input.client_id,
    rdi: input.redirect_uri,
    cch: input.code_challenge,
    exp: Date.now() + CODE_TTL_MS,
  };
  return sign(payload);
}

export function readCode(code: string) {
  return verify<CodePayload>(code, "code");
}

export function issueAccessToken(client_id: string) {
  const payload: TokenPayload = { typ: "at", cid: client_id, exp: Date.now() + TOKEN_TTL_MS };
  return { accessToken: sign(payload), expiresIn: Math.floor(TOKEN_TTL_MS / 1000) };
}

export function readAccessToken(token: string) {
  return verify<TokenPayload>(token, "at");
}

// Google 的账号关联需要长期会话：拿不到 refresh_token 时，
// 关联环节可能直接失败（Gemini 报"必须关联账号"）。
export function issueRefreshToken(client_id: string) {
  const payload: RefreshPayload = { typ: "rt", cid: client_id, exp: Date.now() + REFRESH_TTL_MS };
  return sign(payload);
}

export function readRefreshToken(token: string) {
  return verify<RefreshPayload>(token, "rt");
}

// PKCE S256：base64url(sha256(code_verifier))
export function s256(verifier: string) {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

// 只允许 https 回跳地址，或本机调试用的 http://localhost
export function isSafeRedirectUri(uri: string | null | undefined): uri is string {
  if (!uri) return false;
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}
