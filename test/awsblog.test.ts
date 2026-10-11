import { describe, expect, it } from "vitest"
import awsblog, { __awsblogInternals } from "../server/sources/awsblog"
import { awsBlogChannelGroups, awsBlogOtherId } from "../server/utils/awsblog-index"
import { originSources } from "../shared/pre-sources"

const unfiltered = ["all", "china", "japan", "korea"]
// Tabs that are not blog channel blocks: the unfiltered feeds and What's New.
const notChannels = [...unfiltered, "whatsnew"]

const { whatsNewPost } = __awsblogInternals

describe("awsblog blocks", () => {
  it("has a tab for every channel block and a block for every tab", () => {
    const tabs = Object.keys(originSources.awsblog.sub)
      .filter(sub => !notChannels.includes(sub))
      .map(sub => `awsblog-${sub}`)
    const blocks = [...awsBlogChannelGroups.map(group => group.id), awsBlogOtherId]
    expect(tabs.sort()).toEqual([...blocks].sort())
  })

  it("registers a getter for every tab", () => {
    const tabs = Object.keys(originSources.awsblog.sub).map(sub => `awsblog-${sub}`)
    expect(Object.keys(awsblog).sort()).toEqual(tabs.sort())
  })

  it("keeps the unfiltered feeds first, so the bare awsblog id still means all", () => {
    expect(Object.keys(originSources.awsblog.sub).slice(0, 4)).toEqual(unfiltered)
  })

  it("has a What's New tab that opens aws.amazon.com/new", () => {
    expect(originSources.awsblog.sub).toHaveProperty("whatsnew", {
      title: "What's New",
      home: "https://aws.amazon.com/new/",
    })
  })
})

describe("the What's New feed", () => {
  const entry = (fields: Record<string, string>) => ({ item: { additionalFields: fields } })

  it("links to the announcement on aws.amazon.com and dates it like the blog cards", () => {
    expect(whatsNewPost(entry({
      headline: "Amazon Bedrock now supports reasoning summaries for OpenAI models ",
      headlineUrl: "/about-aws/whats-new/2026/10/amazon-bedrock-reasoning-summaries-openai/",
      postDateTime: "2026-10-09T22:00:00Z",
      postBody: "<p>Amazon Bedrock now supports the <code>reasoning.summary</code> parameter &amp; more.</p>\n<p>Second   paragraph.</p>",
    }))).toEqual({
      link: "https://aws.amazon.com/about-aws/whats-new/2026/10/amazon-bedrock-reasoning-summaries-openai/",
      title: "Amazon Bedrock now supports reasoning summaries for OpenAI models",
      created: "2026-10-09T22:00:00Z",
      info: "09 Oct 2026",
      excerpt: "Amazon Bedrock now supports the reasoning.summary parameter & more. Second paragraph.",
    })
  })

  it("keeps an absolute link as it is", () => {
    const post = whatsNewPost(entry({ headline: "x", headlineUrl: "https://aws.amazon.com/new/x/" }))
    expect(post?.link).toBe("https://aws.amazon.com/new/x/")
  })

  it("skips entries without a headline or a link, and leaves an unparseable date undated", () => {
    expect(whatsNewPost(entry({ headline: "x" }))).toBeUndefined()
    expect(whatsNewPost(entry({ headline: " ", headlineUrl: "/x/" }))).toBeUndefined()
    expect(whatsNewPost(entry({ headline: "x", headlineUrl: "/x/", postDateTime: "soon" }))?.info).toBeUndefined()
  })
})
