import { describe, expect, it } from "vitest"
import { __awsblogInternals } from "../server/sources/awsblog"
import { originSources } from "../shared/pre-sources"

const { categories, feedUrl } = __awsblogInternals

describe("awsblog category filter", () => {
  it("matches a category on either tag axis within one tags.id", () => {
    const url = new URL(feedUrl(categories["awsblog-ai"]))
    expect(url.searchParams.getAll("tags.id")).toEqual([
      "blog-posts#category#artificial-intelligence|blog-posts#category#generative-ai-2|GLOBAL#tech-category#ai-ml",
    ])
  })

  it("gives the 18 tech-category feeds both axes", () => {
    const withTech = Object.entries(categories)
      .filter(([, tags]) => tags.some(tag => tag.startsWith("GLOBAL#tech-category#")))
    expect(withTech).toHaveLength(18)
    for (const [id, tags] of withTech) {
      expect(tags.filter(tag => tag.startsWith("GLOBAL#tech-category#")), id).toHaveLength(1)
      expect(tags.filter(tag => tag.startsWith("blog-posts#category#")).length, id).toBeGreaterThan(0)
    }
  })

  it("avoids the blog homepage filter values that match no posts", () => {
    const dead = ["security", "iot", "mobile", "networking", "compliance", "games", "infrastructure"]
      .map(value => `blog-posts#category#${value}`)
    expect(Object.values(categories).flat().filter(tag => dead.includes(tag))).toEqual([])
  })

  it("has a feed for every category tab and a tab for every feed", () => {
    const tabs = Object.keys(originSources.awsblog.sub)
      .filter(sub => !["all", "china", "japan", "korea"].includes(sub))
      .map(sub => `awsblog-${sub}`)
    expect(Object.keys(categories).sort()).toEqual(tabs.sort())
  })

  it("leaves the unfiltered feeds without tags.id", () => {
    expect(new URL(feedUrl()).searchParams.has("tags.id")).toBe(false)
  })
})
