import { createHash } from "node:crypto"
import process from "node:process"
import { clearTimeout, setTimeout } from "node:timers"
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime"
import AbortController from "abort-controller"
import type { Database } from "db0"

const DEFAULT_MODEL_ID = "jp.anthropic.claude-haiku-4-5-20251001-v1:0"
const SUMMARY_TIMEOUT_MS = 25000
const MAX_CONCURRENCY = 3
const MAX_MEMORY_CACHE_ITEMS = 2000
const MAX_OUTPUT_TOKENS = 500
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Bump when the prompt or post-processing changes, so stale summaries are not reused. */
const PROMPT_VERSION = "s1"

const SYSTEM_PROMPTS = {
  article: `你是技术新闻编辑。读完给定网页正文后，用简体中文写一段 3-5 句话的摘要。

要求：
- 概括文章做了什么、结论是什么、有哪些关键数据或版本号。
- 保留专有名词、产品名、公司名的英文原文。
- 只输出摘要正文。不要标题、不要前缀、不要 markdown、不要引号、不要"本文"之类的套话。
- 如果正文是登录墙、付费墙、报错页、导航列表，或内容不足以概括，只输出 SKIP。`,

  repo: `你是机器学习工程师。读完给定的 Hugging Face 模型卡或数据集卡后，用简体中文写一段 3-5 句话的说明。

要求：
- 说清它是什么、基于哪个基座模型、参数量或数据规模、主要能力和典型用途，以及许可证或使用限制。
- 有基准分数、上下文长度、语言数量这类关键数字就照抄。
- 保留模型名、机构名、指标名、许可证标识的英文原文。
- 只输出正文。不要标题、不要前缀、不要 markdown、不要引号。
- 如果卡片只有模板占位、只有标签列表、只有安装命令，或内容不足以说明，只输出 SKIP。`,
} as const

export type SummaryVariant = keyof typeof SYSTEM_PROMPTS

interface SummarizeInput {
  url: string
  title: string
  text: string
  variant?: SummaryVariant
  /** Extra cache-key input, e.g. a repo's lastModified, so edits are picked up. */
  version?: string
}

interface SummaryRow {
  summary: string
}

const memoryCache = new Map<string, string>()
let client: BedrockRuntimeClient | undefined
let activeRequests = 0
const waiters: Array<() => void> = []
let summaryTableReady: Promise<void> | undefined
let loggedError = false

function modelId() {
  return process.env.SUMMARY_MODEL_ID?.trim() || DEFAULT_MODEL_ID
}

function summaryEnabled() {
  return process.env.SUMMARY_LLM === "true"
}

function remember(id: string, summary: string) {
  memoryCache.delete(id)
  memoryCache.set(id, summary)
  if (memoryCache.size > MAX_MEMORY_CACHE_ITEMS) {
    const oldest = memoryCache.keys().next().value
    if (oldest) memoryCache.delete(oldest)
  }
}

function cacheKey(input: SummarizeInput) {
  const parts = [PROMPT_VERSION, modelId(), input.variant ?? "article", input.version ?? "", input.url]
  return createHash("sha256").update(parts.join(":")).digest("hex")
}

async function getDatabase() {
  try {
    return useDatabase() as Database
  } catch {
    return undefined
  }
}

async function initSummaryTable(db: Database) {
  summaryTableReady ??= (async () => {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS hover_summary (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        summary TEXT NOT NULL,
        updated INTEGER NOT NULL
      );
    `).run()
    await db.prepare("CREATE INDEX IF NOT EXISTS hover_summary_updated ON hover_summary (updated)").run()
    await db.prepare("DELETE FROM hover_summary WHERE updated < ?").run(Date.now() - CACHE_TTL_MS)
  })()
  try {
    await summaryTableReady
  } catch (error) {
    summaryTableReady = undefined
    throw error
  }
}

async function getCachedSummary(db: Database | undefined, id: string) {
  const inMemory = memoryCache.get(id)
  if (inMemory) return inMemory
  if (!db) return

  try {
    await initSummaryTable(db)
    const row = await db.prepare("SELECT summary FROM hover_summary WHERE id = ?").get(id) as SummaryRow | undefined
    if (row?.summary) {
      remember(id, row.summary)
      return row.summary
    }
  } catch {
    return undefined
  }
}

async function setCachedSummary(db: Database | undefined, id: string, url: string, summary: string) {
  remember(id, summary)
  if (!db) return

  try {
    await initSummaryTable(db)
    await db.prepare(`
      INSERT OR REPLACE INTO hover_summary (id, url, summary, updated)
      VALUES (?, ?, ?, ?)
    `).run(id, url, summary, Date.now())
  } catch {
    // Source delivery must not fail when the optional summary cache is unavailable.
  }
}

async function withSummarySlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeRequests < MAX_CONCURRENCY) {
    activeRequests += 1
  } else {
    await new Promise<void>(resolve => waiters.push(resolve))
  }

  try {
    return await fn()
  } finally {
    const next = waiters.shift()
    if (next) next()
    else activeRequests -= 1
  }
}

function cleanSummary(text: string) {
  const compact = text
    .replace(/```[a-z]*\n?|```/gi, "")
    .replace(/^\s*(摘要|总结)\s*[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/^["'“”「」]+|["'“”「」]+$/g, "")
    .trim()
  if (!compact || /^SKIP$/i.test(compact)) return undefined
  // A model that ignored the instructions and echoed the page is worse than no hover.
  return compact.length >= 30 ? compact : undefined
}

async function invoke(input: SummarizeInput) {
  client ??= new BedrockRuntimeClient({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-northeast-1",
  })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS)
  try {
    const response = await client.send(new ConverseCommand({
      modelId: modelId(),
      system: [{ text: SYSTEM_PROMPTS[input.variant ?? "article"] }],
      messages: [{
        role: "user",
        content: [{ text: `标题：${input.title}\n链接：${input.url}\n\n正文：\n${input.text}` }],
      }],
      inferenceConfig: { maxTokens: MAX_OUTPUT_TOKENS, temperature: 0.2 },
    }), { abortSignal: controller.signal as any })
    const text = response.output?.message?.content?.map(part => part.text ?? "").join("").trim()
    return text ? cleanSummary(text) : undefined
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Summarize an article into Chinese for the hover line. Returns undefined when
 * summarization is disabled or unavailable, so callers can fall back to the
 * page's own meta description.
 */
export async function summarizeArticle(input: SummarizeInput): Promise<string | undefined> {
  if (!summaryEnabled()) return undefined

  const id = cacheKey(input)
  const db = await getDatabase()
  const cached = await getCachedSummary(db, id)
  if (cached) return cached

  try {
    const summary = await withSummarySlot(() => invoke(input))
    if (!summary) return undefined
    await setCachedSummary(db, id, input.url, summary)
    return summary
  } catch (error) {
    if (!loggedError) {
      loggedError = true
      logger.warn("hover summarization unavailable; falling back to meta descriptions", error)
    }
    return undefined
  }
}

export const __llmInternals = {
  cleanSummary,
  withSummarySlot,
}
