import type { NewsItem } from "@shared/types"
import * as cheerio from "cheerio"
import { withPageDescriptions } from "#/utils/summary"
import { withTranslatedHover } from "#/utils/translate"

const baseURL = "https://news.ycombinator.com"

interface RSSItem {
  title: string
  link: string
  description?: string
  created?: string
}

async function withHackerNewsDescriptions(entries: { item: NewsItem, summaryUrl: string }[]) {
  // Unlike arXiv, a Hacker News story carries no abstract, so the hover has to
  // be generated from the linked article itself. Summaries are cached per URL,
  // so a refresh only pays for stories that just entered the front page.
  const enriched = await withPageDescriptions(entries.map(({ item, summaryUrl }) => ({
    ...item,
    url: summaryUrl,
  })), { maxFetches: 30, concurrency: 6, llm: true })

  return enriched.map((item, index) => {
    const original = entries[index].item
    const hover = item.extra?.hover?.trim()
    return {
      ...original,
      extra: {
        ...original.extra,
        hover: hover && hover !== original.title.trim()
          ? hover
          : original.title.trim(),
      },
    }
  })
}

async function fetchDirect(): Promise<NewsItem[]> {
  const html: any = await myFetch(baseURL)
  const $ = cheerio.load(html)
  const $main = $(".athing")
  const entries: { item: NewsItem, summaryUrl: string }[] = []
  $main.each((_, el) => {
    const a = $(el).find(".titleline a").first()
    const title = a.text()
    const href = a.attr("href")
    const id = $(el).attr("id")
    const score = $(`#score_${id}`).text()
    const url = `${baseURL}/item?id=${id}`
    if (href && id && title) {
      entries.push({
        item: {
          url,
          title,
          id,
          extra: {
            info: score,
          },
        },
        summaryUrl: new URL(href, baseURL).href,
      })
    }
  })
  return withHackerNewsDescriptions(entries)
}

async function fetchViaRSS(): Promise<NewsItem[]> {
  const data = await rss2json("https://hnrss.org/frontpage?count=30")
  if (!data?.items.length) throw new Error("Cannot fetch rss data")
  const entries = (data.items as RSSItem[]).map((item) => {
    const description = item.description ?? ""
    const url = /Comments URL: <a href="([^"]+)"/.exec(description)?.[1] ?? item.link
    const id = /id=(\d+)/.exec(url)?.[1] ?? url
    const points = /Points: (\d+)/.exec(description)?.[1]
    return {
      item: {
        id,
        title: item.title,
        url,
        pubDate: item.created,
        extra: points
          ? {
              info: `${points} points`,
            }
          : undefined,
      },
      summaryUrl: item.link,
    }
  }).filter(({ item }) => item.id && item.title && item.url)
  return withHackerNewsDescriptions(entries)
}

export default defineSource(async () => {
  const news = await fetchDirect().catch(() => [])
  return withTranslatedHover(news.length ? news : await fetchViaRSS())
})
