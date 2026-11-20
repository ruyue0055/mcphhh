import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { ISSUER, readAccessToken } from "../../lib/oauth-core";

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
  tags: string[];
  raw: string; // 原始 JSONL 行，用作全文兜底检索（日期等也能命中）
};

type RawMemory = Record<string, unknown>;

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function pickString(obj: RawMemory, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

function pickTags(obj: RawMemory): string[] {
  const v = obj.tags ?? obj.labels ?? obj.keywords;
  if (Array.isArray(v)) return v.map(asString).filter(Boolean);
  if (typeof v === "string") return v.split(/[,，;；\s]+/).filter(Boolean);
  return [];
}

// 字段名容错：不同记忆库键名可能不同（topic/title、content/text 等），统一归一化；
// 缺失字段一律落成空串，绝不让 undefined 流到后续 toLowerCase。
function normalize(raw: RawMemory, line: string): Memory {
  return {
    id: asString(raw.id),
    topic: pickString(raw, ["topic", "title", "category", "subject", "name"]),
    content: pickString(raw, ["content", "text", "summary", "body", "note", "description"]),
    tags: pickTags(raw),
    raw: line,
  };
}

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
  const data: Memory[] = [];
  let skipped = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as RawMemory;
      if (obj && typeof obj === "object") data.push(normalize(obj, line));
      else skipped++;
    } catch {
      skipped++; // 坏行跳过，不影响其余条目
    }
  }
  if (skipped > 0) console.warn(`memory.jsonl 有 ${skipped} 行无法解析，已跳过`);

  cache = { data, ts: now };
  return data;
}

// 一个非常朴素的关键词打分，够用；以后可换成向量检索(RAG)
// 检索面 = 主题 + 正文 + 标签 + 原始 JSONL 行（日期、id 等任意字段都能命中）
function score(m: Memory, q: string): number {
  const words = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const tags = m.tags ?? [];
  const hay = `${m.topic ?? ""} ${m.content ?? ""} ${tags.join(" ")} ${m.raw ?? ""}`.toLowerCase();
  let s = 0;
  for (const w of words) {
    if (tags.some((t) => t.toLowerCase() === w)) s += 3;
    if ((m.topic ?? "").toLowerCase().includes(w)) s += 2;
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
          ? ranked
              .map((m) => {
                const head = `#${m.id || "?"} 【${m.topic || "（无主题）"}】`;
                const body = m.content || m.raw || "（无正文）";
                return `${head}\n${body}`;
              })
              .join("\n\n")
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
        const topics = Array.from(
          new Set(all.map((m) => m.topic).filter((t) => typeof t === "string" && t.trim() !== ""))
        );
        const noTopicCount = all.length - all.filter((m) => m.topic && m.topic.trim()).length;
        const lines = topics.length ? topics.map((t) => `- ${t}`).join("\n") : "（暂无可识别的主题字段）";
        const extra = noTopicCount > 0 ? `\n（另有 ${noTopicCount} 条缺少主题字段，仍可用 search_memory 按内容检索）` : "";
        return {
          content: [
            {
              type: "text",
              text: `共 ${all.length} 条记忆，主题包括：\n${lines}${extra}`,
            },
          ],
        };
      }
    );
  },
  {},
  {
    // 本文件位于 app/api/mcp/route.ts，请求路径就是 /api/mcp。
    // mcp-handler 会拼成 basePath + "/mcp"，所以 basePath 必须是 "/api"，
    // 写成 "/api/mcp" 会让它只认 /api/mcp/mcp，导致 /api/mcp 返回 "Not found"。
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: true,
  }
);

// 鉴权包装：没有 Bearer 令牌时返回 401，并在 WWW-Authenticate 头里带上
// resource_metadata 地址。Gemini / mcp-remote 正是靠这个头去发现授权服务器，
// 从而弹出授权页；缺了它，客户端只会报"验证网址重试"。
const authedHandler = withMcpAuth(
  async (req) => handler(req),
  async (_req, bearerToken) => {
    if (!bearerToken) return undefined; // 交给 required: true 生成 401
    const payload = readAccessToken(bearerToken);
    if (!payload) return undefined;
    return {
      token: bearerToken,
      clientId: payload.cid,
      scopes: [],
      expiresAt: Math.floor(payload.exp / 1000),
    };
  },
  {
    required: true,
    // 注意：withMcpAuth 内部是 `${resourceUrl}${resourceMetadataPath}` 直接拼接，
    // 所以这里只能给"站点根地址"，不能带 /api/mcp 路径，
    // 否则 WWW-Authenticate 会指向 .../api/mcp/.well-known/... 这种不存在的路径。
    resourceUrl: ISSUER,
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
  }
);

// Next.js 路由需要把 handler 挂到 GET/POST/DELETE 三个方法上
export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
