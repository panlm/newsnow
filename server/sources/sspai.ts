interface Res {
  data: {
    id: number
    title: string
    summary: string
  }[]
}

export default defineSource(async () => {
  const timestamp = Date.now()
  const limit = 30
  const url = `https://sspai.com/api/v1/article/tag/page/get?limit=${limit}&offset=0&created_at=${timestamp}&tag=%E7%83%AD%E9%97%A8%E6%96%87%E7%AB%A0&released=false`
  const res: Res = await myFetch(url, {
    timeout: 30000,
    retry: 1,
  })
  return res.data.map((k) => {
    const url = `https://sspai.com/post/${k.id}`
    return {
      id: k.id,
      title: k.title,
      url,
      extra: {
        hover: k.summary,
      },
    }
  })
})
