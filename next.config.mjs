/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return {
      // beforeFiles：在文件系统匹配之前生效，保证这些 well-known 地址稳定命中接口。
      // 之所以走 rewrite 而不是放 public/.well-known/，是因为 GitHub 网页端拖拽上传
      // 会跳过以 . 开头的隐藏路径。
      beforeFiles: [
        {
          // 1. 受保护资源元数据（RFC 9728）—— 客户端靠它找到授权服务器，缺了就报"验证网址重试"
          source: '/.well-known/oauth-protected-resource',
          destination: '/api/resource-metadata',
        },
        {
          // 2. 授权服务器元数据（RFC 8414）
          source: '/.well-known/oauth-authorization-server',
          destination: '/api/oauth-metadata',
        },
        {
          // 3. 兼容带 .json 后缀的写法
          source: '/.well-known/oauth-authorization-server.json',
          destination: '/api/oauth-metadata',
        },
        {
          source: '/.well-known/oauth-protected-resource.json',
          destination: '/api/resource-metadata',
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
