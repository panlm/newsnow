import type { AllSourceID } from "@shared/types"
import defu from "defu"
import { withBilingualHover } from "#/utils/translate"
import type { RSSHubOption, RSSHubInfo as RSSHubResponse, SourceGetter, SourceOption } from "#/types"

type R = Partial<Record<AllSourceID, SourceGetter>>
export function defineSource(source: SourceGetter): SourceGetter
export function defineSource(source: R): R
export function defineSource(source: SourceGetter | R): SourceGetter | R {
  return source
}

export function defineRSSSource(url: string, option?: SourceOption): SourceGetter {
  return async () => {
    const data = await rss2json(url)
    if (!data?.items.length) throw new Error("Cannot fetch rss data")
    return data.items.map(item => ({
      title: item.title,
      url: item.link,
      id: item.link,
      pubDate: !option?.hiddenDate ? item.created : undefined,
    }))
  }
}

function cleanRSSDescription(value?: string) {
  if (!value) return undefined
  const text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&#x2019;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
  return text || undefined
}

/**
 * RSS source for 国际版 (world) outlets: carries the item description as an English
 * hover, which withBilingualHover turns into en + zh so the UI switch can flip it.
 */
export function defineBilingualRSSSource(url: string, option?: SourceOption): SourceGetter {
  return async () => {
    const data = await rss2json(url)
    if (!data?.items.length) throw new Error("Cannot fetch rss data")
    const items = data.items.slice(0, MaxItems).map(item => ({
      title: item.title,
      url: item.link,
      id: item.link,
      pubDate: !option?.hiddenDate ? item.created : undefined,
      extra: {
        hover: cleanRSSDescription(item.description),
      },
    }))
    return withBilingualHover(items)
  }
}

export function defineRSSHubSource(route: string, RSSHubOptions?: RSSHubOption, sourceOption?: SourceOption): SourceGetter {
  return async () => {
    // "https://rsshub.pseudoyu.com"
    const RSSHubBase = "https://rsshub.rssforever.com"
    const url = new URL(route, RSSHubBase)
    url.searchParams.set("format", "json")
    RSSHubOptions = defu<RSSHubOption, RSSHubOption[]>(RSSHubOptions, {
      sorted: true,
    })

    Object.entries(RSSHubOptions).forEach(([key, value]) => {
      url.searchParams.set(key, value.toString())
    })
    const data: RSSHubResponse = await myFetch(url)
    return data.items.map(item => ({
      title: item.title,
      url: item.url,
      id: item.id ?? item.url,
      pubDate: !sourceOption?.hiddenDate ? item.date_published : undefined,
    }))
  }
}
