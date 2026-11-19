/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return {
      // beforeFiles：在文件系统匹配之前生效，保证下面两个地址都能命中接口
      beforeFiles: [
        {
          // Gemini 按 RFC 8414 默认请求的地址（不带 .json 后缀）
          source: '/.well-known/oauth-authorization-server',
          destination: '/api/oauth-metadata',
        },
        {
          // 兼容带 .json 后缀的写法
          source: '/.well-known/oauth-authorization-server.json',
          destination: '/api/oauth-metadata',
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
