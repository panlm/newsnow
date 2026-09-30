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
const endpoint = "https://aws.amazon.com/api/dirs/items/search"
const baseQuery = "item.directoryId=blog-posts&sort_by=item.additionalFields.createdDate&sort_order=desc&size=30&item.locale=en_US"

/**
 * Posts carry two category axes. `blog-posts#category` mixes real topics with
 * bookkeeping tags (post-types, learning-levels), so filter on
 * `GLOBAL#tech-category` instead — one tag per AWS service category.
 */
const TECH_CATEGORY_NAMESPACE = "GLOBAL#tech-category"

function feed(category?: string) {
  const url = category
    ? `${endpoint}?${baseQuery}&tags.id=${encodeURIComponent(`${TECH_CATEGORY_NAMESPACE}#${category}`)}`
    : `${endpoint}?${baseQuery}`

  return defineSource(async () => {
    const res = await myFetch<{ items?: AwsBlogItem[] }>(url, { responseType: "json" })
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
}

export default defineSource({
  "awsblog-all": feed(),
  "awsblog-compute": feed("compute"),
  "awsblog-ai": feed("ai-ml"),
  "awsblog-security": feed("security-identity-compliance"),
  "awsblog-databases": feed("databases"),
  "awsblog-analytics": feed("analytics"),
  "awsblog-storage": feed("storage"),
  "awsblog-management": feed("mgmt-govern"),
  "awsblog-networking": feed("networking-content-dev"),
  "awsblog-integration": feed("app-integration"),
  "awsblog-mobile": feed("mobile"),
  "awsblog-devtools": feed("devtools"),
  "awsblog-iot": feed("iot"),
  "awsblog-robotics": feed("robotics"),
  "awsblog-quantum": feed("quantum"),
  "awsblog-media": feed("media-services"),
  "awsblog-migration": feed("migration"),
  "awsblog-satellite": feed("satellite"),
  "awsblog-blockchain": feed("blockchain"),
})
