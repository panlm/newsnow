import type { SourceID } from "@shared/types"
import * as x from "glob:./sources/{*.ts,**/index.ts}"
import type { SourceGetter } from "./types"
import { withPageDescriptions } from "#/utils/summary"

// Default every source to showing a hover: after a getter returns, enrich any item
// that has no hover with its article page's meta/og description (cheap, no LLM,
// cached at the source level). Sources that already set hover are skipped per-item,
// and sources whose items have no readable article page simply stay without one.
function withDefaultHover(getter: SourceGetter): SourceGetter {
  return (async () => {
    const items = await getter()
    try {
      return await withPageDescriptions(items)
    } catch {
      return items
    }
  }) as SourceGetter
}

export const getters = (function () {
  const raw = {} as Record<SourceID, SourceGetter>
  typeSafeObjectEntries(x).forEach(([id, x]) => {
    if (x.default instanceof Function) {
      Object.assign(raw, { [id]: x.default })
    } else {
      Object.assign(raw, x.default)
    }
  })
  const getters = {} as Record<SourceID, SourceGetter>
  typeSafeObjectEntries(raw).forEach(([id, getter]) => {
    getters[id] = withDefaultHover(getter as SourceGetter)
  })
  return getters
})()
