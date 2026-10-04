import { XMLParser } from "fast-xml-parser"
import { htmlToText } from "./html"

/** One post of an RSS 2.0, RSS 1.0 (RDF) or Atom feed. */
export interface FeedEntry {
  title: string
  url: string
  /** Milliseconds since epoch; undefined when the feed gives no usable date. */
  pubDate?: number
  /** Plain-text excerpt: the summary/description, else the start of the content. */
  summary?: string
}

const MAX_SUMMARY_CHARS = 400

// A distinct attribute prefix keeps attributes apart from child elements, which
// matters for Atom (`<link rel href>`, xhtml content) where both occur.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
})

/** All text under a parsed node, attributes excluded (Atom xhtml content nests elements). */
function textOf(node: unknown): string {
  if (node == null) return ""
  if (typeof node !== "object") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(" ")
  return Object.entries(node)
    .filter(([key]) => !key.startsWith("@_"))
    .map(([, value]) => textOf(value))
    .join(" ")
}

/** RSS `<link>` is text; Atom has several `<link rel href>`, the post is the alternate one. */
function linkOf(node: unknown) {
  const nodes = (Array.isArray(node) ? node : [node]).filter(Boolean)
  const alternate = nodes.find((link): link is Record<string, string> =>
    typeof link === "object" && !!link["@_href"] && (!link["@_rel"] || link["@_rel"] === "alternate"))
  if (alternate) return alternate["@_href"]
  return nodes.map(link => textOf(link).trim()).find(link => /^https?:\/\//.test(link))
}

function dateOf(entry: Record<string, unknown>) {
  for (const key of ["published", "pubDate", "dc:date", "updated"]) {
    const time = Date.parse(textOf(entry[key]).trim())
    if (!Number.isNaN(time)) return time
  }
}

function excerpt(html: string) {
  const text = htmlToText(html)
  if (text.length <= MAX_SUMMARY_CHARS) return text || undefined
  const cut = text.slice(0, MAX_SUMMARY_CHARS)
  const space = cut.lastIndexOf(" ")
  return `${space >= MAX_SUMMARY_CHARS * 0.8 ? cut.slice(0, space) : cut}…`
}

/**
 * fast-xml-parser keeps an element's text apart from its child elements, which
 * scrambles mixed content ("Hello <a>world</a>" comes back as "world Hello"). Atom
 * xhtml bodies are mixed content, so hand them over as escaped HTML, which is what
 * type="html" bodies already are.
 */
function escapeXhtmlBodies(xml: string) {
  return xml.replace(
    /<(content|summary)(\s(?:[^>]*\s)?)type=["']xhtml["']([^>]*)>([\s\S]*?)<\/\1>/g,
    (_, tag, before, after, inner: string) =>
      `<${tag}${before}type="html"${after}>${inner.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</${tag}>`,
  )
}

export function parseFeed(xml: string): FeedEntry[] {
  const doc = parser.parse(escapeXhtmlBodies(xml))
  const channel = Array.isArray(doc?.rss?.channel) ? doc.rss.channel[0] : doc?.rss?.channel
  const raw = channel?.item ?? doc?.feed?.entry ?? doc?.["rdf:RDF"]?.item ?? []
  const entries: Record<string, unknown>[] = Array.isArray(raw) ? raw : [raw]
  return entries.flatMap((entry) => {
    const url = linkOf(entry.link) ?? linkOf(entry.guid) ?? linkOf(entry.id)
    const title = htmlToText(textOf(entry.title))
    if (!url || !title) return []
    const body = textOf(entry.description ?? entry.summary) || textOf(entry["content:encoded"] ?? entry.content)
    return [{ title, url, pubDate: dateOf(entry), summary: body ? excerpt(body) : undefined }]
  })
}
