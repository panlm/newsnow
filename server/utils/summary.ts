import type { NewsItem } from "@shared/types"
import * as cheerio from "cheerio"
import { myFetch } from "#/utils/fetch"

/**
 * Add each article page's metadata description without failing the whole source
 * when one publisher page is unavailable.
 */
export async function withPageDescriptions(items: NewsItem[]): Promise<NewsItem[]> {
  return Promise.all(items.map(async (item) => {
    if (item.extra?.hover?.trim())
      return item

    try {
      const html = await myFetch<string>(item.url, {
        timeout: 6000,
        retry: 1,
      })
      const $ = cheerio.load(html)
      const hover = $("meta[name='description']").attr("content")
        || $("meta[property='og:description']").attr("content")

      if (!hover?.trim()) return item
      return {
        ...item,
        extra: {
          ...item.extra,
          hover: hover.trim(),
        },
      }
    } catch {
      return item
    }
  }))
}
