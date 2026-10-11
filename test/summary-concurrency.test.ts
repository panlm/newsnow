import { describe, expect, it } from "vitest"
import { __llmInternals } from "../server/utils/llm"
import { __summaryInternals } from "../server/utils/summary"

const { withSummarySlot } = __llmInternals
const { pageFetchConcurrency } = __summaryInternals

const flush = () => new Promise<void>(resolve => setImmediate(resolve))

describe("summary slots", () => {
  it("runs 12 summaries at once and queues the 13th until a slot frees", async () => {
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    const tasks = Array.from({ length: 13 }, () => withSummarySlot(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>(resolve => releases.push(resolve))
      active -= 1
    }))

    await flush()
    expect(peak).toBe(12)
    expect(releases).toHaveLength(12)

    releases.shift()!()
    await flush()
    expect(releases).toHaveLength(12)
    expect(peak).toBe(12)

    releases.splice(0).forEach(release => release())
    await Promise.all(tasks)
    expect(active).toBe(0)
  })
})

describe("page description workers", () => {
  it("lets a caller ask for 12 workers, clamps above that, and defaults to 4", () => {
    expect(pageFetchConcurrency({ concurrency: 12 })).toBe(12)
    expect(pageFetchConcurrency({ concurrency: 50 })).toBe(12)
    expect(pageFetchConcurrency({})).toBe(4)
  })
})
