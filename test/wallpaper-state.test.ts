import { expect, test } from "bun:test"
import { mergeWallpaperState, rememberWallpaperState } from "../src/ui/wallpaper-state.ts"

test("a scope without wallpaper settings inherits the remembered wallpaper", () => {
  expect(mergeWallpaperState({}, { selection: "workshop:test", muted: true })).toEqual({ selection: "workshop:test", muted: true })
  expect(mergeWallpaperState({ selection: "" }, { selection: "workshop:test" })).toEqual({ selection: "" })
})

test("remembered wallpaper state excludes unrelated settings", () => {
  expect(rememberWallpaperState({ selection: "workshop:test", apiKey: "secret", glassBlur: 12 })).toEqual({ selection: "workshop:test", glassBlur: 12 })
})
