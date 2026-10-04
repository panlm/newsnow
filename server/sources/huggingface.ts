import type { NewsItem } from "@shared/types"
import { summarizeArticle } from "#/utils/llm"
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

const MIN_CARD_CHARS = 300
const MAX_CARD_CHARS = 8000
const CARD_CONCURRENCY = 6
/** Frontmatter keys worth keeping; `model-index` alone can be hundreds of YAML lines. */
const CARD_FRONTMATTER_KEYS = /^(?:license|license_name|library_name|pipeline_tag|base_model|language|task_categories|size_categories|tags):/

function repoTags(repo: HFRepo) {
  const tags = (repo.tags ?? [])
    .filter(tag => !tag.includes(":") && tag !== repo.pipeline_tag && tag !== repo.library_name)
    .slice(0, 5)
  return [repo.pipeline_tag, repo.library_name, ...tags].filter(Boolean).join(" · ")
}

/** Strip the markdown chrome so the card reads as prose worth summarizing. */
function cleanCard(markdown: string) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown)
  let head = ""
  let body = markdown
  if (frontmatter) {
    body = markdown.slice(frontmatter[0].length)
    head = frontmatter[1].split("\n").filter(line => CARD_FRONTMATTER_KEYS.test(line)).join("\n")
  }
  const normalize = (text: string) => text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  // Usage snippets are mostly noise, but a card that is only snippets still beats nothing.
  const withoutCode = normalize(body.replace(/```[\s\S]*?```/g, " "))
  const text = withoutCode.length >= MIN_CARD_CHARS ? withoutCode : normalize(body)
  return `${head}\n\n${text}`.trim().slice(0, MAX_CARD_CHARS)
}

async function fetchRepoCard(repo: HFRepo, kind: "models" | "datasets") {
  const prefix = kind === "datasets" ? "datasets/" : ""
  try {
    // Gated repos answer 401 here; those fall back to the tag list.
    const markdown = await myFetch<string>(`https://huggingface.co/${prefix}${repo.id}/raw/main/README.md`, {
      responseType: "text" as any,
      timeout: 15000,
      retry: 0,
    })
    return typeof markdown === "string" ? cleanCard(markdown) : ""
  } catch {
    return ""
  }
}

/**
 * Model and dataset listings carry no description at all, so the hover used to be
 * the raw tag list — which Amazon Translate then mangled ("safetensors" became
 * 安全传感器). Summarize the repo card instead, and when there is no card leave the
 * tags in English rather than translating identifiers.
 */
async function withRepoSummaries(
  items: NewsItem[],
  repos: HFRepo[],
  kind: "models" | "datasets",
): Promise<NewsItem[]> {
  return mapWithConcurrency(items, CARD_CONCURRENCY, async (item, index) => {
    const repo = repos[index]
    const card = await fetchRepoCard(repo, kind)
    const summary = card.length >= MIN_CARD_CHARS
      ? await summarizeArticle({
        url: item.url,
        title: item.title,
        text: card,
        variant: "repo",
        version: repo.lastModified,
      })
      : undefined
    if (summary) return { ...item, extra: { ...item.extra, hover: summary } }

    const description = cleanText(repo.description)
    if (description) {
      const [translated] = await withTranslatedHover([{ ...item, extra: { ...item.extra, hover: description } }])
      return translated
    }
    return { ...item, extra: { ...item.extra, hover: repoTags(repo) } }
  })
}

const papers = defineSource(async () => {
  const data = await myFetch<HFDailyPaper[]>(`https://huggingface.co/api/daily_papers?limit=${MaxItems}`, requestOptions)
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
  const repos = data.filter(repo => repo.id && (repo.modelId || repo.id))
  const items = repos.map<NewsItem>(repo => ({
    id: repo.id,
    title: repo.modelId || repo.id,
    url: `https://huggingface.co/${repo.id}`,
    pubDate: repo.createdAt,
    extra: {
      info: `♥ ${compactNumber(repo.likes)} · ↓ ${compactNumber(repo.downloads)}`,
    },
  }))
  return withRepoSummaries(items, repos, "models")
})

const datasets = defineSource(async () => {
  const data = await myFetch<HFRepo[]>("https://huggingface.co/api/datasets?sort=trendingScore&direction=-1&limit=30", requestOptions)
  const repos = data.filter(repo => repo.id)
  const items = repos.map<NewsItem>(repo => ({
    id: repo.id,
    title: repo.id,
    url: `https://huggingface.co/datasets/${repo.id}`,
    pubDate: repo.lastModified || repo.createdAt,
    extra: {
      info: `♥ ${compactNumber(repo.likes)} · ↓ ${compactNumber(repo.downloads)}`,
    },
  }))
  return withRepoSummaries(items, repos, "datasets")
})

export default defineSource({
  "huggingface": papers,
  "huggingface-papers": papers,
  "huggingface-models": models,
  "huggingface-datasets": datasets,
})
