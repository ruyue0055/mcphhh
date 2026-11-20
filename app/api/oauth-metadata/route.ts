// 对外提供 OAuth 授权服务器元数据（RFC 8414）
// 说明：仓库里不使用以 . 开头的隐藏路径，改由 next.config.mjs 把
// /.well-known/oauth-authorization-server 重写到这里，这样 GitHub 网页端拖拽上传不会被跳过。

const BASE = "https://mcphhh.vercel.app";

const METADATA = {
  issuer: BASE,
  authorization_endpoint: `${BASE}/api/oauth/authorize`,
  token_endpoint: `${BASE}/api/oauth/token`,
  registration_endpoint: `${BASE}/api/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: ["offline_access"],
  revocation_endpoint: `${BASE}/api/oauth/revoke`,
};

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
};

export async function GET() {
  return new Response(JSON.stringify(METADATA, null, 2), { headers: HEADERS });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
