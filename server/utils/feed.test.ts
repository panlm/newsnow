import { describe, expect, it } from "vitest"
import { parseFeed } from "./feed"
import { firstParagraph, htmlToText } from "./html"

describe("parseFeed", () => {
  it("reads RSS 2.0 items with HTML descriptions", () => {
    const [entry] = parseFeed(`<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title>
      <item><title>Tom &amp; Jerry&#8217;s post</title><link>https://example.com/a</link>
        <pubDate>Tue, 29 Sep 2026 09:30:04 +0000</pubDate>
        <description>&lt;p&gt;First &lt;b&gt;bold&lt;/b&gt;&amp;nbsp;line&lt;/p&gt;</description></item>
    </channel></rss>`)
    expect(entry).toEqual({
      title: "Tom & Jerry’s post",
      url: "https://example.com/a",
      pubDate: Date.UTC(2026, 8, 29, 9, 30, 4),
      summary: "First bold line",
    })
  })

  it("takes the alternate link and the published date of an Atom entry", () => {
    const [entry] = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <title type="html">A &lt;em&gt;quiet&lt;/em&gt; week</title>
      <link rel="replies" href="https://example.com/a#comments"/>
      <link rel="alternate" type="text/html" href="https://example.com/a"/>
      <link rel="self" href="https://example.com/feeds/1"/>
      <published>2026-09-01T10:00:00Z</published><updated>2026-10-01T10:00:00Z</updated>
      <content type="html">&lt;p&gt;Body&lt;/p&gt;</content>
    </entry></feed>`)
    expect(entry.url).toBe("https://example.com/a")
    expect(entry.title).toBe("A quiet week")
    expect(entry.pubDate).toBe(Date.parse("2026-09-01T10:00:00Z"))
    expect(entry.summary).toBe("Body")
  })

  it("flattens xhtml content without leaking attributes", () => {
    const [entry] = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <title>X</title><link href="https://example.com/x"/><updated>2026-09-01T00:00:00Z</updated>
      <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p class="lead">Hello <a href="https://e.com">world</a></p></div></content>
    </entry></feed>`)
    expect(entry.summary).toBe("Hello world")
  })

  it("reads RSS 1.0 (RDF) items and their dc:date", () => {
    const [entry] = parseFeed(`<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel><title>Old school</title></channel>
      <item><title>Hi</title><link>https://example.com/rdf</link><dc:date>2026-09-02T08:00:00Z</dc:date></item>
    </rdf:RDF>`)
    expect(entry).toMatchObject({ url: "https://example.com/rdf", pubDate: Date.parse("2026-09-02T08:00:00Z") })
  })

  it("falls back to content:encoded, cuts long excerpts at a word, keeps undated posts undated", () => {
    const long = `${"word ".repeat(120)}end`
    const [entry] = parseFeed(`<rss><channel><item><title>T</title><link>https://example.com/t</link>
      <content:encoded><![CDATA[<p>${long}</p>]]></content:encoded></item></channel></rss>`)
    expect(entry.pubDate).toBeUndefined()
    expect(entry.summary!.length).toBeLessThanOrEqual(401)
    expect(entry.summary!.endsWith("word…")).toBe(true)
  })

  it("drops entries without a link", () => {
    expect(parseFeed(`<rss><channel><item><title>No link</title></item></channel></rss>`)).toEqual([])
  })
})

describe("htmlToText", () => {
  it("drops scripts and decodes numeric and named entities", () => {
    expect(htmlToText("<script>x()</script>Caf&#xe9; &mdash; &#169; &bogus;")).toBe("Café — © &bogus;")
  })

  it("finds the lede: the first paragraph long enough to be prose", () => {
    const lede = "We announce a new system that provides externally verifiable privacy guarantees while shifting trust away from the server."
    expect(firstParagraph(`<p>Share</p><p class="x">${lede}</p><p>${lede} Again.</p>`)).toBe(lede)
    expect(firstParagraph("<p>Too short</p>")).toBeUndefined()
  })
})
