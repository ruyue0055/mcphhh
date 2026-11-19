// api/oauth/register.js
export default async function handler(req, res) {
  const { client_name, redirect_uris } = req.body;
  
  // 生成 client_id
  const clientId = Math.random().toString(36).substring(2);
  
  global.clients = global.clients || {};
  global.clients[clientId] = { client_name, redirect_uris };
  
  res.json({
    client_id: clientId,
    client_name,
    redirect_uris,
  });
}