import type { FixedColumnID, SourceID } from "@shared/types"
import { sortableColumnIds } from "@shared/metadata"
import type { Update } from "./types"

export const focusSourcesAtom = atom((get) => {
  return get(primitiveMetadataAtom).data.focus
}, (get, set, update: Update<SourceID[]>) => {
  const _ = update instanceof Function ? update(get(focusSourcesAtom)) : update
  set(primitiveMetadataAtom, {
    updatedTime: Date.now(),
    action: "manual",
    data: {
      ...get(primitiveMetadataAtom).data,
      focus: _,
    },
  })
})

export const currentColumnIDAtom = atom<FixedColumnID>("focus")

export const currentSourcesAtom = atom((get) => {
  const id = get(currentColumnIDAtom)
  return get(primitiveMetadataAtom).data[id]
}, (get, set, update: Update<SourceID[]>) => {
  if (!sortableColumnIds.includes(get(currentColumnIDAtom))) return
  const _ = update instanceof Function ? update(get(currentSourcesAtom)) : update
  set(primitiveMetadataAtom, {
    updatedTime: Date.now(),
    action: "manual",
    data: {
      ...get(primitiveMetadataAtom).data,
      [get(currentColumnIDAtom)]: _,
    },
  })
})

export const goToTopAtom = atom({
  ok: false,
  el: undefined as HTMLElement | undefined,
  fn: undefined as (() => void) | undefined,
})

// Hover summary language ("zh" default). Only 国际版 bilingual sources react to it;
// single-language hovers (other modules) ignore it. Persisted per browser.
const HOVER_LANG_KEY = "hoverLang"
const hoverLangBase = atom<"zh" | "en">(
  (typeof localStorage !== "undefined" && localStorage.getItem(HOVER_LANG_KEY) === "en") ? "en" : "zh",
)
export const hoverLangAtom = atom(
  get => get(hoverLangBase),
  (get, set, lang: "zh" | "en") => {
    set(hoverLangBase, lang)
    if (typeof localStorage !== "undefined") localStorage.setItem(HOVER_LANG_KEY, lang)
  },
)
