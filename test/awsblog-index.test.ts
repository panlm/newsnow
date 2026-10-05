import { describe, expect, it } from "vitest"
import type { AwsBlogPost } from "../server/utils/awsblog-index"
import {
  awsBlogChannelGroups,
  awsBlogChannelOf,
  awsBlogOtherId,
  createAwsBlogIndex,
  createAwsBlogMemoryStore,
} from "../server/utils/awsblog-index"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const START = Date.parse("2026-10-05T00:00:00Z")

/** `count` posts in one channel, newest first, the newest at `newest`, `gap` ms apart. */
function postsOf(count: number, { channel = "compute", newest = START, gap = HOUR, tag = "p" } = {}): AwsBlogPost[] {
  return Array.from({ length: count }, (_, i) => ({
    link: `https://aws.amazon.com/blogs/${channel}/${tag}-${i}/`,
    channel,
    title: `${tag} ${i}`,
    created: new Date(newest - i * gap).toISOString(),
  }))
}

/** A directory API over `feed` (newest first) that records each (page, size) request. */
function fakeApi(feed: () => AwsBlogPost[], pageOf?: (page: number, size: number) => AwsBlogPost[]) {
  const calls: [number, number][] = []
  return {
    calls,
    fetchPage: async (page: number, size: number) => {
      calls.push([page, size])
      return pageOf ? pageOf(page, size) : feed().slice(page * size, (page + 1) * size)
    },
  }
}

function setup(initial: AwsBlogPost[]) {
  let feed = initial
  let clock = START
  const api = fakeApi(() => feed)
  const store = createAwsBlogMemoryStore()
  const index = createAwsBlogIndex({ store, fetchPage: api.fetchPage, now: () => clock })
  return {
    api,
    store,
    index,
    publish: (posts: AwsBlogPost[]) => {
      feed = [...posts, ...feed]
    },
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe("awsblog channel groups", () => {
  it("reads the channel from the post URL", () => {
    expect(awsBlogChannelOf("https://aws.amazon.com/blogs/machine-learning/build-x/")).toBe("machine-learning")
    expect(awsBlogChannelOf("/blogs/compute/some-post")).toBe("compute")
    expect(awsBlogChannelOf("https://aws.amazon.com/about-aws/whats-new/")).toBeUndefined()
  })

  it("puts every channel in one block, named after its first channel", () => {
    const channels = awsBlogChannelGroups.flatMap(group => [...group.channels])
    expect(new Set(channels).size).toBe(channels.length)
    expect(awsBlogChannelGroups).toHaveLength(25)
    for (const group of awsBlogChannelGroups) {
      if (group.id === "awsblog-iot-quantum-computing") continue
      expect(group.id).toBe(`awsblog-${group.channels[0]}`)
    }
    expect(awsBlogChannelGroups.map(group => group.id)).not.toContain(awsBlogOtherId)
  })
})

describe("awsblog channel index sync", () => {
  it("seeds an empty store with one large page", async () => {
    const { api, index } = setup(postsOf(3000))
    await index.sync()
    expect(api.calls).toEqual([[0, 2000]])
  })

  it("stops at the first page that holds a post stored before", async () => {
    const { api, index, publish, advance } = setup(postsOf(500))
    await index.sync()
    advance(HOUR)
    publish(postsOf(30, { tag: "new", newest: START + HOUR }))
    await index.sync()
    expect(api.calls.slice(1)).toEqual([[0, 100]])
  })

  it("walks back further when more than a page is new", async () => {
    const { api, index, publish, advance } = setup(postsOf(500))
    await index.sync()
    advance(HOUR)
    publish(postsOf(150, { tag: "new", newest: START + HOUR, gap: 1000 }))
    await index.sync()
    expect(api.calls.slice(1)).toEqual([[0, 100], [1, 100]])
    const links = new Set((await index.postsFor("awsblog-compute")).map(post => post.link))
    expect(postsOf(150, { tag: "new" }).every(post => links.has(post.link))).toBe(true)
  })

  it("keeps walking when a page repeats a post of this same walk", async () => {
    let feed = postsOf(500)
    let clock = START
    // A post published mid-walk shifts later pages down by one, so each repeats one post of the page before.
    const api = fakeApi(() => feed, (page, size) => feed.slice(Math.max(page * size - page, 0), page * size - page + size))
    const index = createAwsBlogIndex({ store: createAwsBlogMemoryStore(), fetchPage: api.fetchPage, now: () => clock })
    await index.sync()
    clock += HOUR
    const fresh = postsOf(250, { tag: "new", newest: START + HOUR, gap: 1000 })
    feed = [...fresh, ...feed]
    await index.sync()
    const links = new Set((await index.postsFor("awsblog-compute")).map(post => post.link))
    expect(fresh.filter(post => !links.has(post.link))).toEqual([])
  })

  it("caps a walk at 20 pages", async () => {
    const { api, index, publish, advance } = setup(postsOf(10))
    await index.sync()
    advance(HOUR)
    publish(postsOf(5000, { tag: "new", newest: START + HOUR, gap: 1000 }))
    await index.sync()
    expect(api.calls.slice(1)).toHaveLength(20)
  })

  it("re-reads the newest 500 posts once a day", async () => {
    const { api, index, advance } = setup(postsOf(500))
    await index.sync()
    advance(DAY)
    await index.sync()
    expect(api.calls.slice(1)).toEqual([[0, 100], [0, 500]])
    advance(HOUR)
    await index.sync()
    expect(api.calls.slice(3)).toEqual([[0, 100]])
  })

  it("shares one sync between concurrent callers and skips it for five minutes", async () => {
    const { api, index, advance } = setup(postsOf(500))
    await Promise.all([index.sync(), index.sync(), index.sync()])
    expect(api.calls).toHaveLength(1)
    advance(4 * 60 * 1000)
    await index.sync()
    expect(api.calls).toHaveLength(1)
    advance(2 * 60 * 1000)
    await index.sync()
    expect(api.calls).toHaveLength(2)
  })
})

describe("awsblog channel blocks", () => {
  it("keeps the last 8 days of a block, at least 100 and at most 500 posts", async () => {
    const count = async (posts: AwsBlogPost[]) => {
      const { index } = setup(posts)
      await index.sync()
      return (await index.postsFor("awsblog-compute")).length
    }
    expect(await count([...postsOf(30), ...postsOf(200, { tag: "old", newest: START - 9 * DAY })])).toBe(100)
    expect(await count(postsOf(150, { gap: HOUR }))).toBe(150)
    expect(await count(postsOf(600, { gap: 10 * 60 * 1000 }))).toBe(500)
  })

  it("gathers every channel of a merged block", async () => {
    const { index } = setup([...postsOf(3, { channel: "compute" }), ...postsOf(2, { channel: "hpc", tag: "h" })])
    await index.sync()
    expect((await index.postsFor("awsblog-compute")).map(post => post.channel).sort()).toEqual(["compute", "compute", "compute", "hpc", "hpc"])
  })

  it("fills the other block with every channel no block lists", async () => {
    const { index } = setup([
      ...postsOf(2, { channel: "web3", tag: "w" }),
      ...postsOf(2, { channel: "brand-new-channel", tag: "b" }),
      ...postsOf(2, { channel: "compute" }),
    ])
    await index.sync()
    expect((await index.postsFor(awsBlogOtherId)).map(post => post.channel).sort())
      .toEqual(["brand-new-channel", "brand-new-channel", "web3", "web3"])
  })
})
