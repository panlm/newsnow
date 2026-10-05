import type { Database } from "db0"
import { MaxItems, RecentDays, RecentMaxItems } from "@shared/consts"

/**
 * The AWS Blog category blocks, one or more blog channels each. The channel is the
 * path segment after /blogs/ and every post has exactly one, so the blocks show each
 * post once and miss none: channels not listed here (tiny or new ones) go to the
 * other block. A block is named after its largest channel.
 */
export const awsBlogChannelGroups = [
  { id: "awsblog-machine-learning", channels: ["machine-learning"] },
  { id: "awsblog-big-data", channels: ["big-data", "business-intelligence"] },
  { id: "awsblog-database", channels: ["database"] },
  { id: "awsblog-security", channels: ["security"] },
  { id: "awsblog-compute", channels: ["compute", "hpc"] },
  { id: "awsblog-containers", channels: ["containers"] },
  { id: "awsblog-storage", channels: ["storage"] },
  { id: "awsblog-networking-and-content-delivery", channels: ["networking-and-content-delivery"] },
  { id: "awsblog-mt", channels: ["mt"] },
  { id: "awsblog-architecture", channels: ["architecture", "multicloud"] },
  { id: "awsblog-migration-and-modernization", channels: ["migration-and-modernization", "modernizing-with-aws"] },
  { id: "awsblog-devops", channels: ["devops", "dotnet", "developer", "opensource", "mobile", "infrastructure-and-automation"] },
  { id: "awsblog-contact-center", channels: ["contact-center", "messaging-and-targeting"] },
  { id: "awsblog-media", channels: ["media"] },
  { id: "awsblog-gametech", channels: ["gametech"] },
  { id: "awsblog-awsforsap", channels: ["awsforsap", "ibm-redhat"] },
  { id: "awsblog-aws-cloud-financial-management", channels: ["aws-cloud-financial-management"] },
  { id: "awsblog-desktop-and-application-streaming", channels: ["desktop-and-application-streaming"] },
  // Named after both its channels so the id says what the block holds.
  { id: "awsblog-iot-quantum-computing", channels: ["iot", "quantum-computing", "physical-ai", "robotics"] },
  { id: "awsblog-aws", channels: ["aws"] },
  { id: "awsblog-publicsector", channels: ["publicsector", "social-impact"] },
  { id: "awsblog-industries", channels: ["industries", "supply-chain"] },
  { id: "awsblog-apn", channels: ["apn", "awsmarketplace"] },
  { id: "awsblog-training-and-certification", channels: ["training-and-certification"] },
  { id: "awsblog-enterprise-strategy", channels: ["enterprise-strategy", "aws-insights"] },
] as const

export const awsBlogOtherId = "awsblog-other" as const

export type AwsBlogBlockId = typeof awsBlogChannelGroups[number]["id"] | typeof awsBlogOtherId

const listedChannels: string[] = awsBlogChannelGroups.flatMap(group => [...group.channels])

export function awsBlogChannelOf(link: string) {
  return link.match(/\/blogs\/([^/]+)\//)?.[1]
}

export interface AwsBlogPost {
  link: string
  channel: string
  title: string
  /** ISO 8601, so it sorts as text. */
  created: string
  displayDate?: string
  excerpt?: string
}

type ChannelFilter = { include: string[] } | { exclude: string[] }

export interface AwsBlogPostStore {
  isEmpty: () => Promise<boolean>
  /** Upserts the posts and returns the links that were stored before. */
  save: (posts: AwsBlogPost[]) => Promise<Set<string>>
  /** Newest first. */
  newest: (filter: ChannelFilter, limit: number) => Promise<AwsBlogPost[]>
}

export function createAwsBlogMemoryStore(): AwsBlogPostStore {
  const posts = new Map<string, AwsBlogPost>()
  return {
    isEmpty: async () => posts.size === 0,
    save: async (batch) => {
      const stored = new Set(batch.map(post => post.link).filter(link => posts.has(link)))
      for (const post of batch) posts.set(post.link, post)
      return stored
    },
    newest: async (filter, limit) => {
      const matches = "include" in filter
        ? (channel: string) => filter.include.includes(channel)
        : (channel: string) => !filter.exclude.includes(channel)
      return [...posts.values()]
        .filter(post => matches(post.channel))
        .sort((a, b) => b.created.localeCompare(a.created))
        .slice(0, limit)
    },
  }
}

export function createAwsBlogDbStore(db: Database): AwsBlogPostStore {
  let ready: Promise<void> | undefined
  const init = async () => {
    ready ??= (async () => {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS awsblog_post (
          link TEXT PRIMARY KEY,
          channel TEXT NOT NULL,
          title TEXT NOT NULL,
          created TEXT NOT NULL,
          display_date TEXT,
          excerpt TEXT,
          updated INTEGER NOT NULL
        );
      `).run()
      await db.prepare("CREATE INDEX IF NOT EXISTS awsblog_post_channel_created ON awsblog_post (channel, created)").run()
    })()
    try {
      await ready
    } catch (error) {
      ready = undefined
      throw error
    }
  }

  return {
    isEmpty: async () => {
      await init()
      return !(await db.prepare("SELECT 1 FROM awsblog_post LIMIT 1").get())
    },
    save: async (batch) => {
      await init()
      const stored = new Set<string>()
      for (const post of batch) {
        if (await db.prepare("SELECT 1 FROM awsblog_post WHERE link = ?").get(post.link)) stored.add(post.link)
        await db.prepare(`
          INSERT OR REPLACE INTO awsblog_post (link, channel, title, created, display_date, excerpt, updated)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(post.link, post.channel, post.title, post.created, post.displayDate ?? null, post.excerpt ?? null, Date.now())
      }
      return stored
    },
    newest: async (filter, limit) => {
      await init()
      const channels = "include" in filter ? filter.include : filter.exclude
      const placeholders = channels.map(() => "?").join(", ")
      const rows = await db.prepare(`
        SELECT link, channel, title, created, display_date AS displayDate, excerpt
        FROM awsblog_post
        WHERE channel ${"include" in filter ? "IN" : "NOT IN"} (${placeholders})
        ORDER BY created DESC
        LIMIT ?
      `).all(...channels, limit) as AwsBlogPost[]
      return rows.map(row => ({ ...row, displayDate: row.displayDate ?? undefined, excerpt: row.excerpt ?? undefined }))
    },
  }
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** One request on first start covers about half a year. */
const SEED_SIZE = 2000
const PAGE_SIZE = 100
const MAX_PAGES = 20
/** Every block refreshes on its own; one walk serves all of them for this long. */
const SYNC_INTERVAL = 5 * 60 * 1000
const RECONCILE_SIZE = 500

/**
 * Keeps a local copy of the blog posts, so each block can show its channels' newest
 * posts although the directory API cannot filter by channel. Posts pile up from
 * refresh to refresh; the store is never backfilled beyond the first page.
 */
export function createAwsBlogIndex({ store, fetchPage, now = Date.now }: {
  store: AwsBlogPostStore
  fetchPage: (page: number, size: number) => Promise<AwsBlogPost[]>
  now?: () => number
}) {
  let running: Promise<void> | undefined
  let lastSync = Number.NEGATIVE_INFINITY
  let lastReconcile = Number.NEGATIVE_INFINITY

  async function walk() {
    if (await store.isEmpty()) {
      await store.save(await fetchPage(0, SEED_SIZE))
      lastReconcile = now()
      return
    }

    // Walk back until a page holds a post stored before this walk, so a gap of more
    // than a page since the last refresh (after downtime, say) is filled too. A post
    // published mid-walk shifts the next page down by one, which repeats a post of
    // this walk; that one does not end it.
    const seen = new Set<string>()
    for (let page = 0; page < MAX_PAGES; page++) {
      const posts = await fetchPage(page, PAGE_SIZE)
      const stored = await store.save(posts)
      const reachedStored = [...stored].some(link => !seen.has(link))
      for (const post of posts) seen.add(post.link)
      if (reachedStored || posts.length < PAGE_SIZE) break
    }

    // A post that shows up with a createdDate older than posts already stored sorts
    // below them, where the walk above never looks.
    if (now() - lastReconcile >= DAY) {
      await store.save(await fetchPage(0, RECONCILE_SIZE))
      lastReconcile = now()
    }
  }

  return {
    sync: async () => {
      if (now() - lastSync < SYNC_INTERVAL) return
      running ??= walk()
        .then(() => {
          lastSync = now()
        })
        .finally(() => {
          running = undefined
        })
      return running
    },

    /** Same rule as the other AWS Blog cards: the last RecentDays days, topped up to MaxItems. */
    postsFor: async (id: AwsBlogBlockId) => {
      const group = awsBlogChannelGroups.find(group => group.id === id)
      const filter = group ? { include: [...group.channels] } : { exclude: listedChannels }
      const posts = await store.newest(filter, RecentMaxItems)
      const since = new Date(now() - RecentDays * DAY).toISOString()
      const inWindow = posts.filter(post => post.created >= since).length
      return posts.slice(0, Math.max(inWindow, MaxItems))
    },
  }
}
