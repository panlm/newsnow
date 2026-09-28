import type { NewsItem } from "@shared/types"
import { withTranslatedHover } from "#/utils/translate"

interface HFAuthor {
  name?: string
}

interface HFPaper {
  id: string
  title: string
  summary?: string
  upvotes?: number
  publishedAt?: string
  submittedOnDailyAt?: string
  authors?: HFAuthor[]
}

interface HFDailyPaper {
  paper: HFPaper
  title?: string
  summary?: string
  publishedAt?: string
}

interface HFRepo {
  id: string
  modelId?: string
  likes?: number
  downloads?: number
  trendingScore?: number
  pipeline_tag?: string
  library_name?: string
  tags?: string[]
  description?: string
  createdAt?: string
  lastModified?: string
}

const requestOptions = {
  timeout: 30000,
  retry: 1,
}

function cleanText(value?: string) {
  return value?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? ""
}

function compactNumber(value = 0) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

function repoHover(repo: HFRepo) {
  const tags = (repo.tags ?? [])
    .filter(tag => !tag.startsWith("region:") && tag !== repo.pipeline_tag && tag !== repo.library_name)
    .slice(0, 5)
  return cleanText(repo.description) || [repo.pipeline_tag, repo.library_name, ...tags].filter(Boolean).join(" · ")
}

const papers = defineSource(async () => {
  const data = await myFetch<HFDailyPaper[]>("https://huggingface.co/api/daily_papers?limit=30", requestOptions)
  const items = data.map<NewsItem>((entry) => {
    const paper = entry.paper
    const authorCount = paper.authors?.length ?? 0
    return {
      id: paper.id,
      title: paper.title || entry.title || paper.id,
      url: `https://huggingface.co/papers/${paper.id}`,
      pubDate: paper.submittedOnDailyAt || paper.publishedAt || entry.publishedAt,
      extra: {
        info: [`▲ ${paper.upvotes ?? 0}`, authorCount ? `${authorCount} authors` : ""].filter(Boolean).join(" · "),
        hover: cleanText(paper.summary || entry.summary),
      },
    }
  }).filter(item => item.id && item.title && item.extra?.hover)
  return withTranslatedHover(items)
})

const models = defineSource(async () => {
  const data = await myFetch<HFRepo[]>("https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=30", requestOptions)
  const items = data.map<NewsItem>(repo => ({
    id: repo.id,
    title: repo.modelId || repo.id,
    url: `https://huggingface.co/${repo.id}`,
    pubDate: repo.createdAt,
    extra: {
      info: `♥ ${compactNumber(repo.likes)} · ↓ ${compactNumber(repo.downloads)}`,
      hover: repoHover(repo),
    },
  })).filter(item => item.id && item.title && item.extra?.hover)
  return withTranslatedHover(items)
})

const datasets = defineSource(async () => {
  const data = await myFetch<HFRepo[]>("https://huggingface.co/api/datasets?sort=trendingScore&direction=-1&limit=30", requestOptions)
  const items = data.map<NewsItem>(repo => ({
    id: repo.id,
    title: repo.id,
    url: `https://huggingface.co/datasets/${repo.id}`,
    pubDate: repo.lastModified || repo.createdAt,
    extra: {
      info: `♥ ${compactNumber(repo.likes)} · ↓ ${compactNumber(repo.downloads)}`,
      hover: repoHover(repo),
    },
  })).filter(item => item.id && item.title && item.extra?.hover)
  return withTranslatedHover(items)
})

export default defineSource({
  "huggingface": papers,
  "huggingface-papers": papers,
  "huggingface-models": models,
  "huggingface-datasets": datasets,
})
