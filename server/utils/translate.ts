import { createHash } from "node:crypto"
import process from "node:process"
import { clearTimeout, setTimeout } from "node:timers"
import { TranslateClient, TranslateTextCommand } from "@aws-sdk/client-translate"
import AbortController from "abort-controller"
import type { NewsItem } from "@shared/types"
import type { Database } from "db0"

const MAX_SOURCE_CHARS = 500
const MAX_CONCURRENCY = 5
const MAX_MEMORY_CACHE_ITEMS = 2000
const TRANSLATE_TIMEOUT_MS = 8000
const TERMINOLOGY_NAME = process.env.TRANSLATE_TERMINOLOGY?.trim()
const memoryCache = new Map<string, string>()
let client: TranslateClient | undefined
let activeRequests = 0
let translationTableReady: Promise<void> | undefined
const waiters: Array<() => void> = []
let loggedError = false

interface TranslationRow {
  translated: string
}

function remember(id: string, translated: string) {
  memoryCache.delete(id)
  memoryCache.set(id, translated)
  if (memoryCache.size > MAX_MEMORY_CACHE_ITEMS) {
    const oldest = memoryCache.keys().next().value
    if (oldest) memoryCache.delete(oldest)
  }
}

function translationEnabled() {
  return process.env.TRANSLATE_HOVER_TO_ZH === "true"
}

function normalizeText(text: string) {
  const compact = text.replace(/\s+/g, " ").trim()
  if (compact.length <= MAX_SOURCE_CHARS) return compact

  const shortened = compact.slice(0, MAX_SOURCE_CHARS)
  const wordBoundary = shortened.lastIndexOf(" ")
  return wordBoundary >= MAX_SOURCE_CHARS * 0.8
    ? shortened.slice(0, wordBoundary)
    : shortened
}

function polishTranslation(text: string, source: string) {
  let result = text
  if (/\bModel Context Protocol\b/i.test(source))
    result = result.replace(/模型上文协议/g, "模型上下文协议")
  if (/\blarge language models?\b/i.test(source))
    result = result.replace(/大型语言模型/g, "大语言模型")
  if (/\btransformers?\b/i.test(source))
    result = result.replace(/变压器|转换器/g, "Transformer")
  if (/\btokens?\b/i.test(source))
    result = result.replace(/代币|令牌/g, "token")
  if (/\breinforcement learning\b/i.test(source))
    result = result.replace(/强化学学习/g, "强化学习")
  if (/\bagents?\b/i.test(source))
    result = result.replace(/(AI|LLM|RL|语言模型)\s*代理/g, "$1 智能体")
  return result
}

function needsEnglishTranslation(text: string) {
  const latinCount = (text.match(/[a-z]/gi) ?? []).length
  const hanCount = (text.match(/[\u3400-\u9FFF]/g) ?? []).length
  return latinCount >= 8 && hanCount < latinCount / 2
}

function cacheKey(text: string) {
  return createHash("sha256").update(`v2:en:zh:${TERMINOLOGY_NAME || "default"}:${text}`).digest("hex")
}

async function getDatabase() {
  try {
    return useDatabase() as Database
  } catch {
    return undefined
  }
}

async function initTranslationTable(db: Database) {
  translationTableReady ??= (async () => {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS hover_translation (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        translated TEXT NOT NULL,
        updated INTEGER NOT NULL
      );
    `).run()
    await db.prepare("CREATE INDEX IF NOT EXISTS hover_translation_updated ON hover_translation (updated)").run()
    await db.prepare("DELETE FROM hover_translation WHERE updated < ?").run(Date.now() - 90 * 24 * 60 * 60 * 1000)
  })()
  try {
    await translationTableReady
  } catch (error) {
    translationTableReady = undefined
    throw error
  }
}

async function getCachedTranslation(db: Database | undefined, id: string) {
  const inMemory = memoryCache.get(id)
  if (inMemory) return inMemory
  if (!db) return

  try {
    await initTranslationTable(db)
    const row = await db.prepare("SELECT translated FROM hover_translation WHERE id = ?").get(id) as TranslationRow | undefined
    if (row?.translated) {
      remember(id, row.translated)
      return row.translated
    }
  } catch {
    return undefined
  }
}

async function setCachedTranslation(db: Database | undefined, id: string, source: string, translated: string) {
  remember(id, translated)
  if (!db) return

  try {
    await initTranslationTable(db)
    await db.prepare(`
      INSERT OR REPLACE INTO hover_translation (id, source, translated, updated)
      VALUES (?, ?, ?, ?)
    `).run(id, source, translated, Date.now())
  } catch {
    // Source delivery must not fail when the optional translation cache is unavailable.
  }
}

async function withTranslateSlot<T>(fn: () => Promise<T>): Promise<T> {
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

async function sendTranslate(command: TranslateTextCommand) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS)
  try {
    return await client!.send(command, { abortSignal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function translateText(text: string) {
  const source = normalizeText(text)
  if (!source || !needsEnglishTranslation(source)) return text

  const id = cacheKey(source)
  const db = await getDatabase()
  const cached = await getCachedTranslation(db, id)
  if (cached) return cached

  try {
    client ??= new TranslateClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-northeast-1",
    })
    const response = await withTranslateSlot(() => sendTranslate(new TranslateTextCommand({
      SourceLanguageCode: "en",
      TargetLanguageCode: "zh",
      TerminologyNames: TERMINOLOGY_NAME ? [TERMINOLOGY_NAME] : undefined,
      Text: source,
    })))
    const translated = response.TranslatedText?.trim()
    if (!translated) return text
    const polished = polishTranslation(translated, source)
    await setCachedTranslation(db, id, source, polished)
    return polished
  } catch (error) {
    if (!loggedError) {
      loggedError = true
      logger.warn("hover translation unavailable; preserving source text", error)
    }
    return text
  }
}

export async function withTranslatedHover(items: NewsItem[]): Promise<NewsItem[]> {
  if (!translationEnabled()) return items

  return Promise.all(items.map(async (item) => {
    const hover = item.extra?.hover?.trim()
    if (!hover) return item
    const translated = await translateText(hover)
    return {
      ...item,
      extra: {
        ...item.extra,
        hover: translated,
      },
    }
  }))
}

export const __translateInternals = {
  normalizeText,
  polishTranslation,
  withTranslateSlot,
}
