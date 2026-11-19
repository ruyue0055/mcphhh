/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return {
      // beforeFiles：在文件系统匹配之前生效，确保无后缀地址能稳定命中 public 下的 json
      beforeFiles: [
        {
          // Gemini 按 RFC 8414 默认请求不带 .json 后缀的地址
          source: '/.well-known/oauth-authorization-server',
          destination: '/.well-known/oauth-authorization-server.json',
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
