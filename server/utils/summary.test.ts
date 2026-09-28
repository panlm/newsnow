import { describe, expect, it } from "vitest"
import { __summaryInternals } from "./summary"

const { isPublicAddress, resolvePublicTarget } = __summaryInternals

describe("article URL safety", () => {
  it("allows globally routable addresses", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true)
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true)
    expect(isPublicAddress("::ffff:808:808")).toBe(true)
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true)
  })

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:7f00:1",
  ])("blocks non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it("rejects unsafe URL forms before requesting them", async () => {
    await expect(resolvePublicTarget(new URL("file:///etc/passwd"))).rejects.toThrow()
    await expect(resolvePublicTarget(new URL("http://127.0.0.1/"))).rejects.toThrow()
    await expect(resolvePublicTarget(new URL("http://169.254.169.254/latest/meta-data/"))).rejects.toThrow()
    await expect(resolvePublicTarget(new URL("http://user:pass@example.com/"))).rejects.toThrow()
    await expect(resolvePublicTarget(new URL("https://example.com:8443/"))).rejects.toThrow()
  })
})
