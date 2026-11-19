import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

// ============================================================
// 环境变量
// MEMORY_JSONL_URL : 记忆库 JSONL 的可访问地址
//   公开仓库示例: https://raw.githubusercontent.com/<你的用户名>/<仓库名>/main/memory.jsonl
//   私有仓库示例: https://api.github.com/repos/<用户名>/<仓库名>/contents/memory.jsonl?ref=main
// GITHUB_TOKEN     : 私有仓库才需要；公开的留空即可
// ============================================================
const MEMORY_URL = process.env.MEMORY_JSONL_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

type Memory = {
  id: string;
  topic: string;
  content: string;
  tags?: string[];
};

// 简单内存缓存，缓解 Serverless 冷启动时反复去 GitHub 拉文件
let cache: { data: Memory[]; ts: number } | null = null;
const CACHE_TTL_MS = 60_000; // 1 分钟

async function loadMemories(): Promise<Memory[]> {
  if (!MEMORY_URL) throw new Error("未配置 MEMORY_JSONL_URL 环境变量");
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS) return cache.data;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw",
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

  const res = await fetch(MEMORY_URL, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`拉取记忆库失败：HTTP ${res.status}`);

  const text = await res.text();
  const data = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Memory);

  cache = { data, ts: now };
  return data;
}

// 一个非常朴素的关键词打分，够用；以后可换成向量检索(RAG)
function score(m: Memory, q: string): number {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${m.topic} ${m.content} ${(m.tags ?? []).join(" ")}`.toLowerCase();
  let s = 0;
  for (const w of words) {
    if (m.tags?.some((t) => t.toLowerCase() === w)) s += 3;
    if (m.topic.toLowerCase().includes(w)) s += 2;
    if (hay.includes(w)) s += 1;
  }
  return s;
}

const handler = createMcpHandler(
  (server) => {
    // 工具 1：按关键词查记忆
    server.registerTool(
      "search_memory",
      {
        title: "检索记忆",
        description:
          "按关键词在你的 GitHub JSONL 记忆库中检索最相关的若干条记忆。输入查询词，返回匹配结果。",
        inputSchema: {
          query: z.string().describe("要检索的关键词或短语"),
          top_k: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe("返回条数，默认 5"),
        },
      },
      async ({ query, top_k = 5 }) => {
        const all = await loadMemories();
        const ranked = all
          .map((m) => ({ m, s: score(m, query) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, top_k)
          .map((x) => x.m);

        const text = ranked.length
          ? ranked.map((m) => `#${m.id} 【${m.topic}】\n${m.content}`).join("\n\n")
          : "没有找到相关记忆。";
        return { content: [{ type: "text", text }] };
      }
    );

    // 工具 2：列出所有主题，帮 Gemini 决定该查什么
    server.registerTool(
      "memory_topics",
      {
        title: "记忆主题清单",
        description: "列出记忆库里全部主题，方便决定该查什么关键词。",
        inputSchema: {},
      },
      async () => {
        const all = await loadMemories();
        const topics = Array.from(new Set(all.map((m) => m.topic)));
        return {
          content: [
            {
              type: "text",
              text: `共 ${all.length} 条记忆，主题包括：\n- ${topics.join("\n- ")}`,
            },
          ],
        };
      }
    );
  },
  {},
  {
    basePath: "/api/mcp",
    maxDuration: 60,
    verboseLogs: true,
  }
);

// Next.js 路由需要把 handler 挂到 GET/POST/DELETE 三个方法上
export { handler as GET, handler as POST, handler as DELETE };
