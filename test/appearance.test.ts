import { expect, test } from "bun:test"
import { createAppearanceController, DEFAULT_APPEARANCE, paletteFromPixels, readAppearance } from "../src/ui/appearance.ts"

test("appearance defaults and limits tolerate old or invalid configuration", () => {
  expect(readAppearance({})).toEqual(DEFAULT_APPEARANCE)
  expect(readAppearance({ glassOpacity: -10, glassBlur: 900, wallpaperDim: NaN, wallpaperBlur: "2", wallpaperTint: false })).toEqual({ ...DEFAULT_APPEARANCE, glassOpacity: 40, glassBlur: 24, wallpaperTint: false })
})

test("palette ignores transparent, black and white pixels and selects the dominant color group", () => {
  expect(paletteFromPixels([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0])).toBe("rgb(112, 128, 144)")
  expect(paletteFromPixels([40, 120, 180, 255, 40, 120, 180, 255, 240, 50, 40, 255])).toBe("rgb(40, 120, 180)")
})

test("stale palette loads and disposed controllers cannot mutate styles", async () => {
  const values = new Map<string, string>()
  const requests: Array<{ signal: AbortSignal; finish: (value: string) => void }> = []
  const controller = createAppearanceController({
    style: { setProperty(key, value) { values.set(key, value ?? "") }, removeProperty(key) { const old = values.get(key) ?? ""; values.delete(key); return old } },
    palette: (_url, signal) => new Promise((finish) => { requests.push({ signal, finish }) }),
  })
  controller.apply(DEFAULT_APPEARANCE, "/first.png")
  controller.apply({ ...DEFAULT_APPEARANCE, glassOpacity: 80 }, "/first.png")
  expect(requests).toHaveLength(1)
  expect(values.get("--swp-fusion-opacity")).toBe("80%")
  controller.apply(DEFAULT_APPEARANCE, "/second.png")
  expect(requests[0]!.signal.aborted).toBe(true)
  requests[0]!.finish("red")
  requests[1]!.finish("blue")
  await Promise.resolve()
  expect(values.get("--swp-fusion-accent")).toBe("blue")
  controller.apply({ ...DEFAULT_APPEARANCE, wallpaperTint: false }, "/second.png")
  expect(values.get("--swp-fusion-tint")).toBe("0%")
  controller.apply(DEFAULT_APPEARANCE, "/third.png")
  controller.dispose()
  requests[2]!.finish("green")
  await Promise.resolve()
  expect(values.size).toBe(0)
})

test("failed palette extraction keeps neutral surfaces and cleanup releases custom properties", async () => {
  const values = new Map<string, string>()
  const controller = createAppearanceController({
    style: { setProperty(key, value) { values.set(key, value ?? "") }, removeProperty(key) { values.delete(key); return "" } },
    palette: async () => { throw new Error("Unreadable preview") },
  })
  controller.apply(DEFAULT_APPEARANCE, "/missing.png")
  await Promise.resolve(); await Promise.resolve()
  expect(values.get("--swp-fusion-accent")).toBe("rgb(112, 128, 144)")
  controller.clear()
  expect(values.size).toBe(0)
})
