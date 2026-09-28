import { withPageDescriptions } from "#/utils/summary"

interface Res {
  data: {
    hotNews: {
      contId: string
      name: string
      pubTimeLong: string
    }[]
  }
}

export default defineSource(async () => {
  const url = "https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar"
  const res: Res = await myFetch(url)
  const items = res.data.hotNews
    .map((k) => {
      return {
        id: k.contId,
        title: k.name,
        url: `https://www.thepaper.cn/newsDetail_forward_${k.contId}`,
        mobileUrl: `https://m.thepaper.cn/newsDetail_forward_${k.contId}`,
      }
    })
  const enriched = await withPageDescriptions(items)
  return enriched.map(item => item.extra?.hover?.trim() && item.extra.hover.trim() !== item.title.trim()
    ? item
    : { ...item, extra: { ...item.extra, hover: "澎湃新闻资讯" } })
})
