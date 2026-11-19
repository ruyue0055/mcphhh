// api/oauth/authorize.js
export default async function handler(req, res) {
  const { client_id, redirect_uri, state, code_challenge } = req.query;
  
  // 这里可以做一个简单的确认页面，或者直接跳过
  // 为了演示，我们直接生成授权码并重定向回去
  const code = Math.random().toString(36).substring(2);
  
  // 把授权码存起来（实际项目用数据库或 Redis）
  // 这里用内存模拟，Vercel 上需要用 Vercel KV 或 Upstash Redis
  global.authCodes = global.authCodes || {};
  global.authCodes[code] = { client_id, redirect_uri, code_challenge };
  
  // 重定向回 Gemini，带上授权码
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);
  
  res.redirect(302, redirectUrl.toString());
}