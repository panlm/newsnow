import { Buffer } from "node:buffer"
import { lookup } from "node:dns/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIP } from "node:net"
import type { LookupFunction } from "node:net"
import type { NewsItem } from "@shared/types"
import * as cheerio from "cheerio"
import { summarizeArticle } from "#/utils/llm"

const MAX_RESPONSE_BYTES = 512 * 1024
const PAGE_TIMEOUT_MS = 8000
const MAX_REDIRECTS = 3
const ARTICLE_USER_AGENT
  = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
const MIN_ARTICLE_CHARS = 400
const MAX_ARTICLE_CHARS = 8000
// `.comtr`/`.commtext` are Hacker News comment rows: Ask HN and Show HN posts
// link back to the item page, where the comment tree would drown the post text.
const BOILERPLATE_SELECTORS = "script, style, noscript, template, svg, iframe, nav, header, footer, aside, form, button, figure figcaption, .nav, .menu, .sidebar, .comment, .comments, .comtr, .commtext, .comhead, .advertisement, .ad, .cookie, .newsletter, .related, .share, .social"
const ARTICLE_SELECTORS = ["article", "main", "[role='main']", ".post-content", ".entry-content", ".article-body", ".post-body", "#content", ".content"]

interface PageDescriptionOptions {
  concurrency?: number
  maxFetches?: number
  /** Summarize the article body with an LLM instead of reusing its meta description. */
  llm?: boolean
}

function isPublicIPv4(address: string) {
  const octets = address.split(".").map(Number)
  if (octets.length !== 4 || octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b, c] = octets
  return !(
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
  )
}

function isPublicIPv6(address: string) {
  const normalized = address.toLowerCase()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)
  if (mapped) return isPublicIPv4(mapped[1])
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized)
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16)
    const low = Number.parseInt(mappedHex[2], 16)
    return isPublicIPv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
  }
  return !(
    normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("::ffff:")
    || /^::\d+\./.test(normalized)
    || normalized.startsWith("64:ff9b:")
    || normalized.startsWith("2001:0:")
    || normalized.startsWith("2002:")
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith("ff")
    || normalized.startsWith("2001:db8:")
  )
}

function isPublicAddress(address: string) {
  const family = isIP(address)
  return family === 4 ? isPublicIPv4(address) : family === 6 && isPublicIPv6(address)
}

async function resolvePublicTarget(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported article protocol")
  if (url.username || url.password) throw new Error("article URL credentials are not allowed")
  if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")))
    throw new Error("nonstandard article port is not allowed")

  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  const family = isIP(hostname)
  const records = family
    ? [{ address: hostname, family }]
    : await lookup(hostname, { all: true, verbatim: true })
  if (!records.length || records.some(record => !isPublicAddress(record.address)))
    throw new Error("article host resolved to a non-public address")
  return records[0]
}

async function fetchPublicHtml(input: string, redirects = 0): Promise<string> {
  const url = new URL(input)
  const target = await resolvePublicTarget(url)
  // Node >= 20 enables autoSelectFamily, which calls the custom lookup with
  // `all: true` and expects an array. Answering with the single-address shape
  // makes the agent read `addresses[0].address` off a string, so every request
  // dies with "Invalid IP address: undefined".
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if ((options as { all?: boolean })?.all) {
      (callback as unknown as (err: null, addresses: { address: string, family: number }[]) => void)(
        null,
        [{ address: target.address, family: target.family }],
      )
      return
    }
    callback(null, target.address, target.family)
  }
  const request = url.protocol === "https:" ? httpsRequest : httpRequest

  return new Promise<string>((resolve, reject) => {
    const req = request(url, {
      headers: {
        // A plain bot UA gets 403'd by a large slice of publishers (openai.com,
        // america.gov, most Cloudflare-fronted sites), which silently costs the
        // hover summary. Present as a normal browser instead.
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": ARTICLE_USER_AGENT,
      },
      lookup: pinnedLookup,
      method: "GET",
    }, (response) => {
      const status = response.statusCode ?? 0
      const locationHeader = response.headers.location
      const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader
      if (status >= 300 && status < 400 && location) {
        response.resume()
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error("too many article redirects"))
          return
        }
        resolve(fetchPublicHtml(new URL(location, url).href, redirects + 1))
        return
      }
      if (status < 200 || status >= 300) {
        response.resume()
        reject(new Error(`article request failed with status ${status}`))
        return
      }

      const contentTypeHeader = response.headers["content-type"]
      const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        response.resume()
        reject(new Error("article response is not HTML"))
        return
      }

      let bytes = 0
      let html = ""
      response.setEncoding("utf8")
      response.on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > MAX_RESPONSE_BYTES) {
          response.destroy(new Error("article response is too large"))
          return
        }
        html += chunk
      })
      response.on("end", () => resolve(html))
      response.on("error", reject)
    })
    req.setTimeout(PAGE_TIMEOUT_MS, () => req.destroy(new Error("article request timed out")))
    req.on("error", reject)
    req.end()
  })
}

function extractMetaDescription($: cheerio.CheerioAPI) {
  const candidates = [
    $("meta[name='description']").attr("content"),
    $("meta[property='og:description']").attr("content"),
    $("meta[name='twitter:description']").attr("content"),
  ]
  return candidates.find(value => value?.trim())?.trim()
}

/** Best-effort main-article text, good enough to summarize but not to render. */
function extractArticleText($: cheerio.CheerioAPI) {
  $(BOILERPLATE_SELECTORS).remove()
  const root = ARTICLE_SELECTORS
    .map(selector => $(selector).first())
    .find(node => node.length > 0 && node.text().replace(/\s+/g, " ").trim().length >= MIN_ARTICLE_CHARS)
    ?? $("body")
  const text = (root?.length ? root : $("body"))
    .text()
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/ {2,}/g, " ")
    .trim()
  return text.slice(0, MAX_ARTICLE_CHARS)
}

async function addPageDescription(item: NewsItem, options: PageDescriptionOptions): Promise<NewsItem> {
  try {
    const html = await fetchPublicHtml(item.url)
    const $ = cheerio.load(html)
    const description = extractMetaDescription($)
    // Read the body before cheerio strips boilerplate, so the meta description
    // stays available as the fallback when summarization is off or fails.
    const articleText = options.llm ? extractArticleText($) : ""
    const summary = options.llm && articleText.length >= MIN_ARTICLE_CHARS
      ? await summarizeArticle({ url: item.url, title: item.title, text: articleText })
      : undefined
    const hover = summary ?? description

    if (!hover) return item
    return {
      ...item,
      extra: {
        ...item.extra,
        hover,
      },
    }
  } catch {
    return item
  }
}

/**
 * Add article metadata descriptions without failing the source when a publisher
 * is unavailable. Requests are bounded and pinned to prevalidated public IPs.
 */
export async function withPageDescriptions(
  items: NewsItem[],
  options: PageDescriptionOptions = {},
): Promise<NewsItem[]> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8))
  const maxFetches = Math.max(0, options.maxFetches ?? 20)
  const result = [...items]
  const candidates = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.extra?.hover?.trim())
    .slice(0, maxFetches)
  let cursor = 0

  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor++]
      result[candidate.index] = await addPageDescription(candidate.item, options)
    }
  }))
  return result
}

export const __summaryInternals = {
  isPublicAddress,
  resolvePublicTarget,
}
