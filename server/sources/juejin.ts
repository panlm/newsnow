interface Res {
  data: {
    content: {
      title: string
      content_id: string
      brief: string
    }
    content_counter: {
      view: number
      like: number
      comment_count: number
    }
    author: {
      name: string
    }
  }[]
}

export default defineSource(async () => {
  const url = `https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot&spider=0`
  const res: Res = await myFetch(url)
  return res.data.map((k) => {
    const url = `https://juejin.cn/post/${k.content.content_id}`
    return {
      id: k.content.content_id,
      title: k.content.title,
      url,
      extra: {
        hover: k.content.brief || `${k.author.name} · ${k.content_counter.view} 阅读 · ${k.content_counter.like} 点赞 · ${k.content_counter.comment_count} 评论`,
      },
    }
  })
})
