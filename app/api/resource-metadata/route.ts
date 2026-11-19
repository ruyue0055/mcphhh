// app/api/resource-metadata/route.ts
// 受保护资源元数据（RFC 9728）
//
// Gemini / mcp-remote 拿到 401 后，会读 WWW-Authenticate 里的 resource_metadata，
// 访问 /.well-known/oauth-protected-resource 来确认"该去哪台授权服务器取令牌"。
// 这个文件缺失 = 授权链路第一步就断，客户端只能报"验证网址重试"。
// next.config.mjs 已把该 well-known 路径重写到本接口。

const BASE = "https://mcphhh.vercel.app";

const METADATA = {
  resource: `${BASE}/api/mcp`,
  authorization_servers: [BASE],
  bearer_methods_supported: ["header"],
  resource_documentation: BASE,
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
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
