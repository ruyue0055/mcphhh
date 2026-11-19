// api/oauth/token.js
import * as oauth from 'oauth4webapi';

export default async function handler(req, res) {
  const { code, client_id, code_verifier } = req.body;
  
  // 取出之前存的授权码信息
  const authCode = global.authCodes?.[code];
  if (!authCode || authCode.client_id !== client_id) {
    return res.status(400).json({ error: 'invalid_grant' });
  }
  
  // 生成 access_token（实际项目用 JWT）
  const accessToken = Math.random().toString(36).substring(2);
  global.accessTokens = global.accessTokens || {};
  global.accessTokens[accessToken] = { client_id, expiresAt: Date.now() + 3600000 };
  
  // 删除用过的授权码
  delete global.authCodes[code];
  
  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
  });
}