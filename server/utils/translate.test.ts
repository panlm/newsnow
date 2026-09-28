import { setTimeout as delay } from "node:timers/promises"
import { describe, expect, it } from "vitest"
import { __translateInternals } from "./translate"

const { normalizeText, polishTranslation, withTranslateSlot } = __translateInternals

describe("hover translation helpers", () => {
  it("never admits more than five concurrent translations", async () => {
    let active = 0
    let peak = 0
    await Promise.all(Array.from({ length: 40 }, () => withTranslateSlot(async () => {
      active += 1
      peak = Math.max(peak, active)
      await delay(2)
      active -= 1
    })))
    expect(peak).toBe(5)
  })

  it("trims long source text at a nearby word boundary", () => {
    const text = `${"word ".repeat(120)}ending`
    const normalized = normalizeText(text)
    expect(normalized.length).toBeLessThanOrEqual(500)
    expect(normalized.endsWith("word")).toBe(true)
  })

  it("polishes technical terms only when present in the source", () => {
    expect(polishTranslation("变压器使用令牌", "A transformer uses tokens"))
      .toBe("Transformer使用token")
    expect(polishTranslation("电源转换器", "A power converter"))
      .toBe("电源转换器")
  })
})
