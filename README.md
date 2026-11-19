# JSONL 记忆库 → Vercel MCP Server → Gemini 调用 起步包

把存在 GitHub 的 JSONL 记忆库，包装成一个 **Remote MCP Server**，部署到 Vercel，
再让 Gemini 通过它按需检索你的记忆。整个链路：

    你的前端 / Gemini  ⇄  MCP Server（Vercel）  ⇄  JSONL 记忆库（GitHub）

---

## 0. 你会用到的工具（MCP Server 提供的两个 Tool）

| 工具名 | 作用 | 参数 |
|--------|------|------|
| `search_memory` | 按关键词在记忆库里检索最相关的几条 | `query`(必填) / `top_k`(选填，默认5) |
| `memory_topics` | 列出记忆库里全部主题，方便决定查什么 | 无 |

---

## 1. 准备 GitHub 记忆库

1. 新建一个仓库（公开 Public 最省事；想私密就设 Private）。
2. 把本目录里的 `memory.jsonl` 上传到仓库根目录，改成你自己的内容。
   - 一行一条 JSON，字段：`id` / `topic` / `content` / `tags`。
   - 例：
     `{"id":"001","topic":"部署偏好","content":"免费额度优先，用 Vercel。","tags":["部署"]}`
3. 记下它的**原始文件地址**：
   - 公开：`https://raw.githubusercontent.com/<用户名>/<仓库名>/main/memory.jsonl`
   - 私有：`https://api.github.com/repos/<用户名>/<仓库名>/contents/memory.jsonl?ref=main`
     （私有还需要配一个有 `repo` 读权限的 token，见下一步）

---

## 2. 本地跑起来

用本起步包（已含全部代码），或直接新建一个 Next.js 项目再把 `app/api/mcp/[transport]/route.ts` 放进去。

```bash
# 在起步包目录里
npm install

# 配置环境变量（复制示例后填真实地址）
cp .env.example .env.local
# 编辑 .env.local，填 MEMORY_JSONL_URL；私有仓库再填 GITHUB_TOKEN

# 本地启动
npm run dev
```

启动后，MCP 接口在：`http://localhost:3000/api/mcp`

---

## 3. 部署到 Vercel

最快的两种方式：

- **命令行**：`npm i -g vercel` → 在项目根目录执行 `vercel`，一路回车。
- **网页**：把代码 push 到 GitHub → 打开 vercel.com → Import 该仓库 → 一键 Deploy。

**关键：在 Vercel 后台加环境变量**（Settings → Environment Variables）：
- `MEMORY_JSONL_URL` = 第 1 步记下的地址
- `GITHUB_TOKEN`（私有仓库才加）= 你的 token

部署完成后得到域名，MCP 地址就是：`https://<你的项目>.vercel.app/api/mcp`

> 提示：MCP 走的是长连接(SSE/Streamable HTTP)，`route.ts` 里已设 `maxDuration: 60`。
> 免费版偶发冷启动慢属正常，代码里已加了 1 分钟缓存来缓解。

---

## 4. 让 Gemini 通过 MCP / Skills 调用它

Gemini CLI 里把 MCP 地址配进去即可（参考本目录 `gemini-settings.example.json`）：

```json
{
  "mcpServers": {
    "my-memory": {
      "command": "npx",
      "args": ["mcp-remote", "https://<你的项目>.vercel.app/api/mcp"]
    }
  }
}
```

配置好重启后，Gemini 就能“看到”你的两个工具，并自己决定何时去查记忆。

**Skills 与 MCP 的分工（别混淆）**：
- **MCP Server**（你刚部署的）= 提供“数据 + 工具”，即真正去 GitHub 拉 JSONL 的那一端。
- **Skills** = 提供“说明书”，一段文字，告诉 Gemini「什么时候该查记忆、拿到后怎么用」。

例如写一条 Skill / 系统提示：
> “回答任何关于我个人偏好、技术选型、部署习惯的问题前，先调用 search_memory 工具检索，
>  不要凭空猜测；检索不到再按常识回答。”

这样 Gemini 就会主动、按需地调用你的记忆库，而不是每次都全量塞进上下文。

---

## 5. 常见问题

- **Gemini 看不到工具？** → 确认部署域名的 `/api/mcp` 能在浏览器返回内容（非 404），且 mcp-remote 已安装。
- **拉不到 JSONL？** → 公开仓库检查 raw 地址是否能在浏览器打开；私有仓库检查 token 是否有 repo 读权限。
- **文件太大 / Token 爆？** → 别一次返回整个文件。本代码默认只返回 `top_k` 条命中结果；后续可把打分换成向量检索(RAG)。

---

## 目录结构

```
memory-mcp-starter/
├── app/
│   ├── page.tsx                       # 最小首页（保证 build 通过）
│   └── api/mcp/[transport]/route.ts   # ★ MCP Server 核心代码
├── memory.jsonl                       # 示例记忆库，改成你自己的
├── package.json                       # 依赖
├── tsconfig.json                      # TS 配置
├── .env.example                       # 环境变量模板
├── gemini-settings.example.json       # Gemini 配置模板
└── README.md                          # 本说明
