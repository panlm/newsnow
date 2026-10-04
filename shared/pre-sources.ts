import process from "node:process"
import { Interval, RecentMaxItems } from "./consts"
import { typeSafeObjectFromEntries } from "./type.util"
import type { OriginSource, Source, SourceID } from "./types"

const Time = {
  Test: 1,
  Realtime: 2 * 60 * 1000,
  Fast: 5 * 60 * 1000,
  Default: Interval, // 10min
  Common: 30 * 60 * 1000,
  Slow: 60 * 60 * 1000,
}

export const originSources = {
  "v2ex": {
    name: "V2EX",
    color: "slate",
    home: "https://v2ex.com/",
    sub: {
      share: {
        title: "最新分享",
        column: "tech",
      },
    },
  },
  "zhihu": {
    name: "知乎",
    type: "hottest",
    column: "china",
    color: "blue",
    home: "https://www.zhihu.com",
  },
  "weibo": {
    name: "微博",
    title: "实时热搜",
    type: "hottest",
    column: "china",
    color: "red",
    interval: Time.Realtime,
    home: "https://weibo.com",
  },
  "zaobao": {
    name: "联合早报",
    interval: Time.Common,
    type: "realtime",
    column: "world",
    color: "red",
    desc: "来自第三方网站: 早晨报",
    home: "https://www.zaobao.com",
  },
  "coolapk": {
    name: "酷安",
    type: "hottest",
    column: "tech",
    color: "green",
    title: "今日最热",
    home: "https://coolapk.com",
  },
  "mktnews": {
    name: "MKTNews",
    column: "finance",
    home: "https://mktnews.net",
    color: "indigo",
    interval: Time.Realtime,
    sub: {
      flash: {
        title: "快讯",
      },
    },
  },
  "wallstreetcn": {
    name: "华尔街见闻",
    color: "blue",
    column: "finance",
    home: "https://wallstreetcn.com/",
    sub: {
      quick: {
        type: "realtime",
        interval: Time.Fast,
        title: "快讯",
      },
      news: {
        title: "最新",
        interval: Time.Common,
      },
      hot: {
        title: "最热",
        type: "hottest",
        interval: Time.Common,
      },
    },
  },
  "36kr": {
    name: "36氪",
    type: "realtime",
    color: "blue",
    home: "https://36kr.com",
    column: "tech",
    disable: "cf",
    sub: {
      quick: {
        title: "快讯",
      },
      renqi: {
        type: "hottest",
        title: "人气榜",
      },
    },
  },
  "douyin": {
    name: "抖音",
    type: "hottest",
    column: "china",
    color: "gray",
    home: "https://www.douyin.com",
  },
  "hupu": {
    name: "虎扑",
    home: "https://hupu.com",
    column: "sports",
    title: "主干道热帖",
    type: "hottest",
    color: "red",
  },
  "dongqiudi": {
    name: "懂球帝",
    title: "头条",
    type: "realtime",
    column: "sports",
    color: "green",
    home: "https://www.dongqiudi.com",
  },
  "aihot": {
    name: "AIHOT",
    type: "realtime",
    column: "tech",
    color: "blue",
    interval: Time.Fast,
    home: "https://aihot.virxact.com/all",
  },
  "tieba": {
    name: "百度贴吧",
    title: "热议",
    column: "china",
    type: "hottest",
    color: "blue",
    home: "https://tieba.baidu.com",
  },
  "toutiao": {
    name: "今日头条",
    type: "hottest",
    column: "china",
    color: "red",
    home: "https://www.toutiao.com",
  },
  "ithome": {
    name: "IT之家",
    color: "red",
    column: "tech",
    type: "realtime",
    home: "https://www.ithome.com",
  },
  "thepaper": {
    name: "澎湃新闻",
    interval: Time.Common,
    type: "hottest",
    column: "china",
    title: "热榜",
    color: "gray",
    home: "https://www.thepaper.cn",
  },
  "sputniknewscn": {
    name: "卫星通讯社",
    color: "orange",
    column: "world",
    home: "https://sputniknews.cn",
  },
  "cankaoxiaoxi": {
    name: "参考消息",
    color: "red",
    column: "world",
    interval: Time.Common,
    home: "https://china.cankaoxiaoxi.com",
  },
  "instagram": {
    name: "Instagram",
    title: "新闻号",
    color: "rose",
    column: "world",
    interval: Time.Common,
    home: "https://www.instagram.com",
  },
  "bbcworld": {
    name: "BBC",
    title: "World",
    color: "red",
    column: "world",
    interval: Time.Common,
    home: "https://www.bbc.com/news/world",
  },
  "guardianworld": {
    name: "The Guardian",
    title: "World",
    color: "blue",
    column: "world",
    interval: Time.Common,
    home: "https://www.theguardian.com/world",
  },
  "aljazeera": {
    name: "Al Jazeera",
    title: "News",
    color: "amber",
    column: "world",
    interval: Time.Common,
    home: "https://www.aljazeera.com",
  },
  "nytworld": {
    name: "NYT",
    title: "World",
    color: "slate",
    column: "world",
    interval: Time.Common,
    home: "https://www.nytimes.com/section/world",
  },
  "pcbeta": {
    name: "远景论坛",
    color: "blue",
    column: "tech",
    home: "https://bbs.pcbeta.com",
    sub: {
      windows11: {
        title: "Win11",
        type: "realtime",
        interval: Time.Fast,
      },
      windows: {
        title: "Windows 资源",
        type: "realtime",
        interval: Time.Fast,
        disable: true,
      },
    },
  },
  "cls": {
    name: "财联社",
    color: "red",
    column: "finance",
    home: "https://www.cls.cn",
    sub: {
      telegraph: {
        title: "电报",
        interval: Time.Fast,
        type: "realtime",
      },
      depth: {
        title: "深度",
      },
      hot: {
        title: "热门",
        type: "hottest",
      },
    },
  },
  "xueqiu": {
    name: "雪球",
    color: "blue",
    home: "https://xueqiu.com",
    column: "finance",
    sub: {
      hotstock: {
        title: "热门股票",
        interval: Time.Realtime,
        type: "hottest",
      },
    },
  },
  "gelonghui": {
    name: "格隆汇",
    color: "blue",
    title: "事件",
    column: "finance",
    type: "realtime",
    interval: Time.Realtime,
    home: "https://www.gelonghui.com",
  },
  "fastbull": {
    name: "法布财经",
    color: "emerald",
    home: "https://www.fastbull.cn",
    column: "finance",
    sub: {
      express: {
        title: "快讯",
        type: "realtime",
        interval: Time.Realtime,
      },
      news: {
        title: "头条",
        interval: Time.Common,
      },
    },
  },
  "solidot": {
    name: "Solidot",
    color: "teal",
    column: "tech",
    home: "https://solidot.org",
    interval: Time.Slow,
  },
  // Source filenames must not contain a hyphen: the rollup glob turns them into
  // import identifiers, so `aws-blog` would be parsed as `aws` minus `blog`.
  "awsblog": {
    name: "AWS Blog",
    color: "orange",
    column: "tech",
    interval: Time.Common,
    // Kept by date, not count (see server/sources/awsblog.ts); this only caps it.
    maxItems: RecentMaxItems,
    home: "https://aws.amazon.com/blogs/",
    // `all` must stay first: genSources points the bare `awsblog` id at the
    // first sub, so the old全分类 bookmark keeps resolving.
    sub: {
      all: { title: "全分类" },
      china: { title: "中国", home: "https://aws.amazon.com/cn/blogs/china/" },
      japan: { title: "日本", home: "https://aws.amazon.com/jp/blogs/news/" },
      korea: { title: "韩国", home: "https://aws.amazon.com/ko/blogs/" },
      compute: { title: "计算" },
      ai: { title: "机器学习与 AI" },
      security: { title: "安全与合规" },
      databases: { title: "数据库" },
      analytics: { title: "分析" },
      storage: { title: "存储" },
      management: { title: "管理与治理" },
      networking: { title: "网络与内容分发" },
      integration: { title: "应用集成" },
      mobile: { title: "移动" },
      devtools: { title: "开发者工具" },
      iot: { title: "物联网" },
      robotics: { title: "机器人" },
      quantum: { title: "量子技术" },
      media: { title: "媒体服务" },
      migration: { title: "迁移" },
      satellite: { title: "卫星" },
      blockchain: { title: "区块链" },
    },
  },
  "arxiv": {
    name: "arXiv",
    title: "AI 最新论文",
    color: "red",
    column: "tech",
    type: "realtime",
    interval: Time.Slow,
    home: "https://arxiv.org/",
  },
  "huggingface": {
    name: "Hugging Face",
    color: "yellow",
    column: "tech",
    home: "https://huggingface.co/",
    interval: Time.Common,
    sub: {
      papers: {
        title: "Daily Papers",
        type: "hottest",
        home: "https://huggingface.co/papers",
      },
      models: {
        title: "热门模型",
        type: "hottest",
        home: "https://huggingface.co/models?sort=trending",
      },
      datasets: {
        title: "热门数据集",
        type: "hottest",
        home: "https://huggingface.co/datasets?sort=trending",
      },
    },
  },
  "anthropic": {
    name: "Anthropic",
    color: "amber",
    column: "tech",
    interval: Time.Common,
    home: "https://www.anthropic.com/news",
    // `news` must stay first: the bare `anthropic` id predates the subs and
    // genSources points it at the first one.
    sub: {
      news: { title: "News" },
      engineering: { title: "Engineering", home: "https://www.anthropic.com/engineering" },
      research: { title: "Research", home: "https://www.anthropic.com/research" },
    },
  },
  "googleai": {
    name: "Google AI",
    color: "blue",
    column: "tech",
    interval: Time.Common,
    home: "https://blog.google/technology/ai/",
    sub: {
      news: { title: "News" },
      research: { title: "Research", home: "https://research.google/blog/" },
    },
  },
  "metaai": {
    name: "Meta AI",
    color: "indigo",
    column: "tech",
    interval: Time.Slow,
    home: "https://ai.meta.com/blog/",
    sub: {
      blog: { title: "Blog" },
      news: { title: "Newsroom", home: "https://about.fb.com/news/tag/ai/" },
    },
  },
  "hnblogs": {
    name: "HN 热门博客",
    title: "2025",
    color: "orange",
    column: "tech",
    interval: Time.Slow,
    // Kept by date, not count (see server/sources/hnblogs); this only caps it.
    maxItems: RecentMaxItems,
    home: "https://refactoringenglish.com/tools/hn-popularity/",
  },
  "hackernews": {
    name: "Hacker News",
    color: "orange",
    column: "tech",
    type: "hottest",
    home: "https://news.ycombinator.com/",
  },
  "producthunt": {
    name: "Product Hunt",
    color: "red",
    column: "tech",
    type: "hottest",
    home: "https://www.producthunt.com/",
  },
  "github": {
    name: "Github",
    color: "gray",
    home: "https://github.com/",
    column: "tech",
    sub: {
      "trending-today": {
        title: "Today",
        type: "hottest",
      },
    },
  },
  "bilibili": {
    name: "哔哩哔哩",
    color: "blue",
    home: "https://www.bilibili.com",
    sub: {
      "hot-search": {
        title: "热搜",
        column: "china",
        type: "hottest",
      },
      "hot-video": {
        title: "热门视频",
        disable: "cf",
        column: "china",
        type: "hottest",
      },
      "ranking": {
        title: "排行榜",
        column: "china",
        disable: "cf",
        type: "hottest",
        interval: Time.Common,
      },
    },
  },
  "kuaishou": {
    name: "快手",
    type: "hottest",
    column: "china",
    color: "orange",
    // cloudflare pages cannot access
    disable: "cf",
    home: "https://www.kuaishou.com",
  },
  "kaopu": {
    name: "靠谱新闻",
    column: "world",
    color: "gray",
    interval: Time.Common,
    desc: "不一定靠谱，多看多思考",
    home: "https://kaopu.news/",
  },
  "jin10": {
    name: "金十数据",
    column: "finance",
    color: "blue",
    type: "realtime",
    home: "https://www.jin10.com",
  },
  "baidu": {
    name: "百度热搜",
    column: "china",
    color: "blue",
    type: "hottest",
    home: "https://www.baidu.com",
  },
  "linuxdo": {
    name: "LINUX DO",
    column: "tech",
    color: "slate",
    home: "https://linux.do/",
    disable: true,
    sub: {
      latest: {
        title: "最新",
        home: "https://linux.do/latest",
      },
      hot: {
        title: "今日最热",
        type: "hottest",
        interval: Time.Common,
        home: "https://linux.do/hot",
      },
    },
  },
  "ghxi": {
    name: "果核剥壳",
    column: "china",
    color: "yellow",
    home: "https://www.ghxi.com/",
    disable: true,
  },
  "smzdm": {
    name: "什么值得买",
    column: "china",
    color: "red",
    type: "hottest",
    home: "https://www.smzdm.com",
    disable: true,
  },
  "nowcoder": {
    name: "牛客",
    column: "china",
    color: "blue",
    type: "hottest",
    home: "https://www.nowcoder.com",
  },
  "sspai": {
    name: "少数派",
    column: "tech",
    color: "red",
    type: "hottest",
    home: "https://sspai.com",
  },
  "juejin": {
    name: "稀土掘金",
    column: "tech",
    color: "blue",
    type: "hottest",
    home: "https://juejin.cn",
  },
  "ifeng": {
    name: "凤凰网",
    column: "china",
    color: "red",
    type: "hottest",
    title: "热点资讯",
    home: "https://www.ifeng.com",
  },
  "chongbuluo": {
    name: "虫部落",
    column: "china",
    color: "green",
    home: "https://www.chongbuluo.com",
    sub: {
      latest: {
        title: "最新",
        interval: Time.Common,
        home: "https://www.chongbuluo.com/forum.php?mod=guide&view=newthread",
      },
      hot: {
        title: "最热",
        type: "hottest",
        interval: Time.Common,
        home: "https://www.chongbuluo.com/forum.php?mod=guide&view=hot",
      },
    },
  },
  "douban": {
    name: "豆瓣",
    column: "china",
    title: "热门电影",
    color: "green",
    type: "hottest",
    home: "https://www.douban.com",
  },
  "steam": {
    name: "Steam",
    column: "world",
    title: "在线人数",
    color: "blue",
    type: "hottest",
    home: "https://store.steampowered.com",
  },
  "tencent": {
    name: "腾讯新闻",
    column: "china",
    color: "blue",
    home: "https://news.qq.com",
    sub: {
      hot: {
        title: "综合早报",
        type: "hottest",
        interval: Time.Common,
        home: "https://news.qq.com/tag/aEWqxLtdgmQ=",
      },
    },
  },
  "freebuf": {
    name: "Freebuf",
    column: "china",
    title: "网络安全",
    color: "green",
    type: "hottest",
    home: "https://www.freebuf.com/",
  },

  "qqvideo": {
    name: "腾讯视频",
    column: "china",
    color: "blue",
    home: "https://v.qq.com/",
    sub: {
      "tv-hotsearch": {
        title: "热搜榜",
        type: "hottest",
        interval: Time.Common,
        home: "https://v.qq.com/channel/tv",

      },
    },
  },
  "iqiyi": {
    name: "爱奇艺",
    column: "china",
    color: "green",
    home: "https://www.iqiyi.com",
    sub: {
      "hot-ranklist": {
        title: "热播榜",
        type: "hottest",
        interval: Time.Common,
        home: "https://www.iqiyi.com",
      },
    },
  },
} as const satisfies Record<string, OriginSource>

export function genSources() {
  const _: [SourceID, Source][] = []

  Object.entries(originSources).forEach(([id, source]: [any, OriginSource]) => {
    const parent = {
      name: source.name,
      type: source.type,
      disable: source.disable,
      desc: source.desc,
      column: source.column,
      home: source.home,
      color: source.color ?? "primary",
      interval: source.interval ?? Time.Default,
      maxItems: source.maxItems,
    }
    if (source.sub && Object.keys(source.sub).length) {
      Object.entries(source.sub).forEach(([subId, subSource], i) => {
        if (i === 0) {
          _.push([
            id,
            {
              redirect: `${id}-${subId}`,
              ...parent,
              ...subSource,
            },
          ] as [any, Source])
        }
        _.push([`${id}-${subId}`, { ...parent, ...subSource }] as [
          any,
          Source,
        ])
      })
    } else {
      _.push([
        id,
        {
          title: source.title,
          ...parent,
        },
      ])
    }
  })

  return typeSafeObjectFromEntries(
    _.filter(([_, v]) => {
      if (v.disable === "cf" && process.env.CF_PAGES) {
        return false
      } else {
        return v.disable !== true
      }
    }),
  )
}
