import type { SourceID } from "@shared/types"
import * as x from "glob:./sources/{*.ts,**/index.ts}"
import { sources } from "@shared/sources"
import type { SourceGetter } from "./types"
import { withPageDescriptions } from "#/utils/summary"
import { withBilingualHoverAuto } from "#/utils/translate"

// Default every source to showing a hover: after a getter returns, enrich any item
// that has no hover with its article page's meta/og description (cheap, no LLM,
// cached at the source level). Sources that already set hover are skipped per-item,
// and sources whose items have no readable article page simply stay without one.
// 国际版 (world) sources are additionally made bilingual so the EN/中 switch applies
// to every item, not only the ones whose getter produced both languages.
function withDefaultHover(id: SourceID, getter: SourceGetter): SourceGetter {
  return (async () => {
    let items = await getter()
    try {
      items = await withPageDescriptions(items)
    } catch {}
    if ((sources[id]?.column as string) === "world") {
      try {
        items = await withBilingualHoverAuto(items)
      } catch {}
    }
    return items
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
    getters[id] = withDefaultHover(id as SourceID, getter as SourceGetter)
  })
  return getters
})()
