const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
}

function fromCodePoint(code: number, fallback: string) {
  return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : fallback
}

/** Strip tags and decode entities: feed HTML or a page snippet to one line of text. */
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => fromCodePoint(Number.parseInt(hex, 16), match))
    .replace(/&#(\d+);/g, (match, dec) => fromCodePoint(Number.parseInt(dec, 10), match))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * The lede of an article page: its first paragraph long enough to be prose. For
 * pages whose meta description is missing or the site-wide blurb.
 */
export function firstParagraph(html: string, minChars = 120) {
  return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
    .map(match => htmlToText(match[1]))
    .find(text => text.length >= minChars)
}
