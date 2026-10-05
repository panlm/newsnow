import { describe, expect, it } from "vitest"
import awsblog from "../server/sources/awsblog"
import { awsBlogChannelGroups, awsBlogOtherId } from "../server/utils/awsblog-index"
import { originSources } from "../shared/pre-sources"

const unfiltered = ["all", "china", "japan", "korea"]

describe("awsblog blocks", () => {
  it("has a tab for every channel block and a block for every tab", () => {
    const tabs = Object.keys(originSources.awsblog.sub)
      .filter(sub => !unfiltered.includes(sub))
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
})
