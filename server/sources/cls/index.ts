import type { NewsItem } from "@shared/types"
import { getSearchParams } from "./utils"
import { withPageDescriptions } from "#/utils/summary"

async function withClsDescriptions(items: NewsItem[]) {
  const enriched = await withPageDescriptions(items)
  return enriched.map(item => item.extra?.hover?.trim() && item.extra.hover.trim() !== item.title.trim()
    ? item
    : { ...item, extra: { ...item.extra, hover: "财联社资讯" } })
}

interface Item {
  id: number
  title?: string
  brief: string
  shareurl: string
  // need *1000
  ctime: number
  // 1
  is_ad: number
}
interface TelegraphRes {
  data: {
    roll_data: Item[]
  }
}

interface Depthes {
  data: {
    top_article: Item[]
    depth_list: Item[]
  }
}

interface Hot {
  data: Item[]
}

const depth = defineSource(async () => {
  const apiUrl = `https://www.cls.cn/v3/depth/home/assembled/1000`
  const res: Depthes = await myFetch(apiUrl, {
    query: Object.fromEntries(await getSearchParams()),
    timeout: 30000,
    retry: 1,
  })
  const items = res.data.depth_list.sort((m, n) => n.ctime - m.ctime).map((k) => {
    return {
      id: k.id,
      title: k.title || k.brief,
      extra: {
        hover: k.brief,
      },
      mobileUrl: k.shareurl,
      pubDate: k.ctime * 1000,
      url: `https://www.cls.cn/detail/${k.id}`,
    }
  })
  return withClsDescriptions(items)
})

const hot = defineSource(async () => {
  const apiUrl = `https://www.cls.cn/v2/article/hot/list`
  const res: Hot = await myFetch(apiUrl, {
    query: Object.fromEntries(await getSearchParams()),
    timeout: 30000,
    retry: 1,
  })
  const items = res.data.map((k) => {
    return {
      id: k.id,
      title: k.title || k.brief,
      extra: {
        hover: k.brief,
      },
      mobileUrl: k.shareurl,
      url: `https://www.cls.cn/detail/${k.id}`,
    }
  })
  return withClsDescriptions(items)
})

const telegraph = defineSource(async () => {
  const apiUrl = `https://www.cls.cn/v1/roll/get_roll_list`
  const res: TelegraphRes = await myFetch(apiUrl, {
    query: Object.fromEntries(await getSearchParams({
      last_time: Math.floor(Date.now() / 1000),
      refresh_type: 1,
      rn: 30,
    })),
    timeout: 30000,
    retry: 1,
    headers: {
      Referer: "https://www.cls.cn/telegraph",
    },
  })
  const items = res.data.roll_data.filter(k => !k.is_ad).map((k) => {
    return {
      id: k.id,
      title: k.title || k.brief,
      extra: {
        hover: k.brief,
      },
      mobileUrl: k.shareurl,
      pubDate: k.ctime * 1000,
      url: `https://www.cls.cn/detail/${k.id}`,
    }
  })
  return withClsDescriptions(items)
})

export default defineSource({
  "cls": telegraph,
  "cls-telegraph": telegraph,
  "cls-depth": depth,
  "cls-hot": hot,
})
