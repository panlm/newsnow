import { createHash } from "node:crypto"
import process from "node:process"
import { setTimeout as delay } from "node:timers/promises"
import { describe, expect, it } from "vitest"
import { __translateInternals } from "./translate"

const { cacheKey, needsTranslation, normalizeText, polishTranslation, withTranslateSlot } = __translateInternals

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

  it("keeps the en -> zh cache key unchanged so cached translations stay valid", () => {
    const terminology = process.env.TRANSLATE_TERMINOLOGY?.trim() || "default"
    expect(cacheKey("Hello world", "en"))
      .toBe(createHash("sha256").update(`v5:en:zh:${terminology}:Hello world`).digest("hex"))
    expect(cacheKey("Hello world", "ja")).not.toBe(cacheKey("Hello world", "en"))
  })

  it("tells Japanese and Korean apart from Chinese by kana and hangul", () => {
    expect(needsTranslation("AWS DevOps Agent Skills を作成するためのベストプラクティス", "ja")).toBe(true)
    expect(needsTranslation("亚马逊云科技发布新的生成式人工智能服务", "ja")).toBe(false)
    expect(needsTranslation("Anthropic Claude Opus 5, Sonnet 5, Amazon Bedrock 서울 리전 출시", "ko")).toBe(true)
    expect(needsTranslation("AWS Weekly Roundup: Amazon Bedrock and more", "ko")).toBe(false)
  })
})
