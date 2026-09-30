import type { NewsItem } from "@shared/types"
import { withTranslatedHover } from "#/utils/translate"

interface AwsBlogItem {
  item?: {
    additionalFields?: {
      title?: string
      link?: string
      displayDate?: string
      postExcerpt?: string
    }
  }
}

// The directory search API returns every blog channel at once (machine-learning,
// containers, networking, security, ...), unlike the per-channel RSS feeds.
const endpoint = "https://aws.amazon.com/api/dirs/items/search?item.directoryId=blog-posts&sort_by=item.additionalFields.createdDate&sort_order=desc&size=30&item.locale=en_US"

export default defineSource(async () => {
  const res = await myFetch<{ items?: AwsBlogItem[] }>(endpoint, { responseType: "json" })
  const items = (res?.items ?? [])
    .map<NewsItem | null>((entry) => {
      const fields = entry?.item?.additionalFields
      if (!fields?.link || !fields?.title) return null
      return {
        id: fields.link,
        title: fields.title,
        url: fields.link,
        extra: {
          info: fields.displayDate,
          hover: fields.postExcerpt?.replace(/\s+/g, " ").trim(),
        },
      }
    })
    .filter((item): item is NewsItem => !!item)
  return withTranslatedHover(items)
})
