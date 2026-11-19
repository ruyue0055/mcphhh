// api/mcp.js
export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const token = authHeader.substring(7);
  const tokenData = global.accessTokens?.[token];
  
  if (!tokenData || tokenData.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
  
  // Token 有效，继续执行 MCP 逻辑
  // ... 你原来的代码 ...
}