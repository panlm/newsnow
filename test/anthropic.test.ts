import { describe, expect, it } from "vitest"
import { __anthropicInternals } from "../server/sources/anthropic"

const { parseListing } = __anthropicInternals

describe("anthropic listing parser", () => {
  it("reads /news cards (title in a __title span)", () => {
    const html = `<a class="x" href="/news/claude-5"><time class="Card__date">Oct 1, 2026</time><span class="Card-module__ab12__title">Claude 5</span></a>`
    expect(parseListing(html, "news")).toEqual([
      { url: "https://www.anthropic.com/news/claude-5", title: "Claude 5", date: "Oct 1, 2026" },
    ])
  })

  it("reads /engineering cards (title in a plain heading) and skips other sections", () => {
    const html = `<a href="/engineering/harness-design"><div><img alt="ignored"/></div><div><h3 class="headline-4">Harness design &amp; more</h3><div><time dateTime="2026-03-24">Mar 24, 2026</time></div></div></a>
      <a href="/news/not-this-one"><h3>Elsewhere</h3></a>`
    expect(parseListing(html, "engineering")).toEqual([
      { url: "https://www.anthropic.com/engineering/harness-design", title: "Harness design & more", date: "Mar 24, 2026" },
    ])
  })

  it("keeps an undated featured post on top", () => {
    const html = `<a href="/engineering/featured"><h2>Featured</h2></a><a href="/engineering/older"><h3>Older</h3><time>Mar 24, 2026</time></a>`
    expect(parseListing(html, "engineering").map(post => post.title)).toEqual(["Featured", "Older"])
  })

  it("orders /research by date although the featured grid comes first", () => {
    const html = `<a href="/research/featured"><time>Sep 4, 2026</time><h4 class="headline-6 Grid__W1__title">Featured</h4></a>
      <a href="/research/newer"><time>Sep 30, 2026</time><span class="List__Kx__title body-3">Newer</span></a>
      <a href="/research/newer"><span class="List__Kx__title">Newer again</span></a>`
    expect(parseListing(html, "research").map(post => post.title)).toEqual(["Newer", "Featured"])
  })
})
