interface Res {
  data: {
    realtime: {
      word: string
      num: number
      flag_desc?: string
      label_name?: string
      icon?: string
      is_ad?: number
    }[]
  }
}

export default defineSource(async () => {
  const baseurl = "https://s.weibo.com"
  const res: Res = await myFetch("https://weibo.com/ajax/side/hotSearch", {
    headers: {
      Referer: "https://weibo.com/",
    },
  })

  return res.data.realtime
    .filter(item => !item.is_ad)
    .slice(0, 30)
    .map((item) => {
      const title = item.word.trim()
      const url = `${baseurl}/weibo?q=${encodeURIComponent(title)}&Refer=top`
      return {
        id: title,
        title,
        url,
        mobileUrl: url,
        extra: {
          icon: item.icon ? { url: item.icon, scale: 1.5 } : undefined,
          hover: [`热度 ${item.num}`, item.flag_desc || item.label_name]
            .filter(Boolean)
            .join(" · "),
        },
      }
    })
})
