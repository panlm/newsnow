import { XMLParser } from "fast-xml-parser"
import type { NewsItem } from "@shared/types"
import { withTranslatedHover } from "#/utils/translate"

interface ArxivAuthor {
  name?: string
}

interface ArxivCategory {
  term?: string
}

interface ArxivEntry {
  id?: string
  title?: string
  summary?: string
  published?: string
  author?: ArxivAuthor | ArxivAuthor[]
  category?: ArxivCategory | ArxivCategory[]
}

function asArray<T>(value?: T | T[]): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function cleanText(value?: string) {
  return value?.replace(/\s+/g, " ").trim() ?? ""
}

export default defineSource(async () => {
  const query = new URLSearchParams({
    search_query: "cat:cs.AI",
    sortBy: "submittedDate",
    sortOrder: "descending",
    start: "0",
    max_results: String(MaxItems),
  })
  const xmlText = await myFetch<string>(`https://export.arxiv.org/api/query?${query}`, {
    responseType: "text" as any,
    timeout: 30000,
    retry: 1,
  })
  const xml = new XMLParser({
    attributeNamePrefix: "",
    ignoreAttributes: false,
  }).parse(xmlText)
  const entries = asArray<ArxivEntry>(xml?.feed?.entry)

  const items = entries.map<NewsItem>((entry) => {
    const id = cleanText(entry.id).split("/abs/").pop() ?? ""
    const authors = asArray(entry.author).map(author => cleanText(author.name)).filter(Boolean)
    const categories = asArray(entry.category).map(category => category.term).filter(Boolean)
    const authorInfo = authors.length > 1 ? `${authors[0]} 等 ${authors.length} 位作者` : authors[0]
    return {
      id,
      title: cleanText(entry.title),
      url: `https://arxiv.org/abs/${id}`,
      pubDate: entry.published,
      extra: {
        info: [authorInfo, categories.slice(0, 2).join(" · ")].filter(Boolean).join(" · "),
        hover: cleanText(entry.summary),
      },
    }
  }).filter(item => item.id && item.title && item.extra?.hover)
  return withTranslatedHover(items)
})
