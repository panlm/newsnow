interface Item {
  uri: string
  id: number
  title?: string
  content_text: string
  content_more?: string
  content_short: string
  display_time: number
  type?: string
}
interface LiveRes {
  data: {
    items: Item[]
  }
}

interface NewsRes {
  data: {
    items: {
      // ad
      resource_type?: string
      resource: Item
    }[]
  }
}

interface ArticleRes {
  data: Item
}
interface HotRes {
  data: {
    day_items: Item[]
  }
}

// https://github.com/DIYgod/RSSHub/blob/master/lib/routes/wallstreetcn/live.ts
const live = defineSource(async () => {
  const apiUrl = `https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=30`

  const res: LiveRes = await myFetch(apiUrl)
  return res.data.items
    .map((k) => {
      return {
        id: k.id,
        title: k.title || k.content_text,
        extra: {
          date: k.display_time * 1000,
          hover: k.title
            ? [k.content_text, k.content_more].filter(Boolean).join(" ")
            : (k.content_more || "华尔街见闻实时快讯"),
        },
        url: k.uri,
      }
    })
})

const news = defineSource(async () => {
  const apiUrl = `https://api-one.wallstcn.com/apiv1/content/information-flow?channel=global-channel&accept=article&limit=30`

  const res: NewsRes = await myFetch(apiUrl)
  return res.data.items
    .filter(k => k.resource_type !== "theme" && k.resource_type !== "ad" && k.resource.type !== "live" && k.resource.uri)
    .map(({ resource: h }) => {
      return {
        id: h.id,
        title: h.title || h.content_short,
        extra: {
          date: h.display_time * 1000,
          hover: h.content_short && h.content_short !== (h.title || h.content_short)
            ? h.content_short
            : "华尔街见闻资讯",
        },
        url: h.uri,
      }
    })
})

const hot = defineSource(async () => {
  const apiUrl = `https://api-one.wallstcn.com/apiv1/content/articles/hot?period=all`

  const res: HotRes = await myFetch(apiUrl)
  return Promise.all(res.data.day_items.map(async (h) => {
    let hover: string | undefined
    try {
      const detail: ArticleRes = await myFetch(`https://api-one.wallstcn.com/apiv1/content/articles/${h.id}`, {
        query: { extract: 0 },
        timeout: 6000,
        retry: 1,
      })
      hover = detail.data.content_short
    } catch {
      hover = "华尔街见闻热门资讯"
    }
    return {
      id: h.id,
      title: h.title!,
      url: h.uri,
      extra: {
        hover,
      },
    }
  }))
})

export default defineSource({
  "wallstreetcn": live,
  "wallstreetcn-quick": live,
  "wallstreetcn-news": news,
  "wallstreetcn-hot": hot,
})
