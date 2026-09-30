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

/**
 * Amazon Translate renders "Amazon Bedrock" as 亚马逊基岩 and "Amazon Web Services"
 * as 亚马逊网络服务. Custom terminology cannot fix it: an en->en entry is never
 * reported in AppliedTerminologies and never applied, so product names have to
 * be repaired after the fact. Each rule only fires when the English source
 * actually mentions the product.
 */
const PRODUCT_NAME_FIXES: [RegExp, RegExp, string][] = [
  [/\bAmazon Web Services\b|\bAWS\b/i, /亚马逊网络服务|亚马逊\s?Web\s?服务|亚马逊云科技/g, "AWS"],
  [/\bAmazon Bedrock\b/i, /亚马逊基岩|亚马逊\s?Bedrock/g, "Amazon Bedrock"],
  [/\bBedrock\b/, /基岩/g, "Bedrock"],
  [/\bAmazon Redshift\b/i, /亚马逊红移/g, "Amazon Redshift"],
  [/\bRedshift\b/, /红移/g, "Redshift"],
  [/\bAmazon Athena\b/i, /亚马逊雅典娜/g, "Amazon Athena"],
  [/\bAmazon Aurora\b/i, /亚马逊极光/g, "Amazon Aurora"],
  [/\bAmazon DynamoDB\b/i, /亚马逊发电机/g, "Amazon DynamoDB"],
  [/\bAmazon CloudWatch\b/i, /亚马逊云观察|亚马逊云手表/g, "Amazon CloudWatch"],
  [/\bAmazon CloudFront\b/i, /亚马逊云锋/g, "Amazon CloudFront"],
  [/\bAmazon Connect\b/i, /亚马逊连接/g, "Amazon Connect"],
  [/\bAmazon Nova\b/i, /亚马逊新星/g, "Amazon Nova"],
  [/\bAmazon Titan\b/i, /亚马逊泰坦/g, "Amazon Titan"],
  [/\bAmazon Inspector\b/i, /亚马逊检查员/g, "Amazon Inspector"],
  [/\bAmazon Outposts\b/i, /亚马逊前哨/g, "Amazon Outposts"],
  [/\bAmazon Location Service\b/i, /亚马逊定位服务/g, "Amazon Location Service"],
  [/\bAmazon Sustainability Data Initiative\b/i, /亚马逊可持续发展数据倡议/g, "Amazon Sustainability Data Initiative"],
  [/\bAWS Glue\b/i, /AWS\s?胶水/g, "AWS Glue"],
  [/\bAWS Fargate\b/i, /AWS\s?法盖特/g, "AWS Fargate"],
  [/\bStep Functions\b/i, /阶跃函数|步进函数/g, "Step Functions"],
]

function polishProductNames(text: string, source: string) {
  let result = text
  for (const [sourceGuard, pattern, replacement] of PRODUCT_NAME_FIXES) {
    if (sourceGuard.test(source)) result = result.replace(pattern, replacement)
  }
  // Catch the long tail: any "Amazon <Name>" the engine turned into "亚马逊 <Name>".
  if (/\bAmazon [A-Z]/.test(source)) {
    result = result
      .replace(/亚马逊\s*(?=[A-Za-z])/g, "Amazon ")
      .replace(/Amazon {2,}/g, "Amazon ")
  }
  // The engine likes to emit its own Chinese rendering followed by the English
  // product name in parentheses ("亚马逊简单存储服务（Amazon S3）"), and the AWS rule
  // above turns "Amazon Web Services (AWS)" into "AWS (AWS)". Drop the redundant half.
  return result
    .replace(/亚马逊[一-鿿]*\s*[（(]\s*(AWS|Amazon [^)）]+?)\s*[)）]/g, "$1")
    .replace(/\bAWS\s*[（(]\s*AWS\s*[)）]/g, "AWS")
    .replace(/\b(Amazon [A-Za-z0-9]+(?: [A-Za-z0-9]+)*?)\s*[（(]\s*\1\s*[)）]/g, "$1")
}

function polishTranslation(text: string, source: string) {
  let result = polishProductNames(text, source)
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
  // Restoring English product names leaves them jammed against the surrounding
  // Chinese ("通过Amazon Bedrock在"), so re-space the CJK/Latin boundaries.
  return result
    .replace(/([一-鿿])([A-Za-z0-9])/g, "$1 $2")
    .replace(/([A-Za-z0-9])([一-鿿])/g, "$1 $2")
    .replace(/ {2,}/g, " ")
    .trim()
}

function needsEnglishTranslation(text: string) {
  const latinCount = (text.match(/[a-z]/gi) ?? []).length
  const hanCount = (text.match(/[\u3400-\u9FFF]/g) ?? []).length
  return latinCount >= 8 && hanCount < latinCount / 2
}

function cacheKey(text: string) {
  return createHash("sha256").update(`v5:en:zh:${TERMINOLOGY_NAME || "default"}:${text}`).digest("hex")
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
  polishProductNames,
  withTranslateSlot,
}
