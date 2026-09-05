import { expect, test } from "bun:test"
import type { PluginSurfaceContext } from "@ericsanchezok/synergy-plugin/ui"
import type { WallpaperRoster, WallpaperSummary } from "../src/server/types.ts"
import { createWallpaperController } from "../src/ui/wallpaper-controller.ts"
import { createAppearanceController } from "../src/ui/appearance.ts"

const wallpaper: WallpaperSummary = { id: "test", collection: "workshop", title: "Test", kind: "video", supported: true, previewUrl: null, entryUrl: "http://127.0.0.1:1/test.mp4", properties: [], contentRating: null }
const roster: WallpaperRoster = { wallpapers: [wallpaper], installFound: true, steamRootsFound: true }
const tick = () => new Promise((done) => setTimeout(done, 0))

function fixture(
  initial: Record<string, unknown> = { selection: "workshop:test" },
  options: { read?: () => Promise<Record<string, unknown>>; query?: () => Promise<WallpaperRoster> } = {},
) {
  const listeners = new Set<(values: Record<string, unknown>) => void>()
  const mounted: Array<{ url: string | null; muted: boolean; stopped: boolean }> = []
  let active = false
  let failPlayback: (message: string) => void = () => {}
  const failures: Array<(message: string) => void> = []
  let query = options.query ?? (async () => roster)
  const read = options.read ?? (async () => initial)
  const styles = new Map<string, string>()
  const appearance = createAppearanceController({ style: {
    setProperty(name, value) { styles.set(name, value ?? "") },
    removeProperty(name) { const value = styles.get(name) ?? ""; styles.delete(name); return value },
  } })
  const context = {
    settings: { get: () => read(), subscribe(listener: (values: Record<string, unknown>) => void) { listeners.add(listener); return () => { listeners.delete(listener) } } },
    operations: { query: () => query() },
    host: { notify() { throw new Error("ui.hostActions was not granted") } },
  } as unknown as PluginSurfaceContext
  const controller = createWallpaperController(context, {
    translucent(value) { active = value },
    mount(summary, muted, onError, onReady) { const layer = { url: summary.entryUrl, muted, stopped: false }; mounted.push(layer); failures.push(onError); failPlayback = onError; onReady(); return () => { layer.stopped = true } },
  }, appearance)
  return { controller, mounted, styles, listeners, failures, active: () => active, fail(message: string) { failPlayback(message) }, update(values: Record<string, unknown>) { for (const listener of listeners) listener(values) }, query(next: typeof query) { query = next } }
}

test("appearance previews and discard never restart the saved video", async () => {
  const state = fixture({ selection: "workshop:test", glassOpacity: 90 })
  await tick()
  const owner = Symbol()
  state.controller.preview(owner, { selection: "workshop:test", glassOpacity: 58 }, roster)
  expect(state.styles.get("--swp-fusion-opacity")).toBe("58%")
  state.controller.clearPreview(owner)
  expect(state.styles.get("--swp-fusion-opacity")).toBe("90%")
  state.update({ selection: "workshop:test", glassOpacity: 76 })
  await tick()
  expect(state.styles.get("--swp-fusion-opacity")).toBe("76%")
  expect(state.mounted).toHaveLength(1)
  expect(state.mounted[0]!.stopped).toBe(false)
  state.controller.dispose()
  expect(state.styles.size).toBe(0)
})

test("playback failure and disabled selection remove fusion styles", async () => {
  const state = fixture()
  await tick()
  expect(state.styles.size).toBe(6)
  state.fail("Decode error")
  expect(state.styles.size).toBe(0)
  state.controller.preview(Symbol(), { selection: "workshop:test", glassOpacity: 58 }, roster)
  expect(state.styles.size).toBe(0)
  state.controller.retry()
  expect(state.styles.size).toBe(6)
  state.controller.preview(Symbol(), {}, roster)
  expect(state.styles.size).toBe(0)
  state.controller.dispose()
})

test("playback errors are visible without ui.hostActions and can be retried", async () => {
  const state = fixture()
  await tick()
  state.fail("Blocked media")
  expect(state.active()).toBe(false)
  expect(state.controller.status()).toEqual({ state: "error", message: "Blocked media" })
  state.controller.retry()
  expect(state.mounted).toHaveLength(2)
  expect(state.active()).toBe(true)
  state.controller.dispose()
})

test("restores a saved selection without opening settings", async () => {
  const state = fixture()
  await tick()
  expect(state.mounted).toHaveLength(1)
  expect(state.active()).toBe(true)
  state.controller.dispose()
  expect(state.mounted[0]!.stopped).toBe(true)
  expect(state.active()).toBe(false)
  expect(state.listeners.size).toBe(0)
})

test("late playback errors cannot stop a retry of the same wallpaper", async () => {
  const state = fixture()
  await tick()
  state.controller.retry()
  state.failures[0]!("Stale media error")
  expect(state.active()).toBe(true)
  expect(state.mounted[1]!.stopped).toBe(false)
  expect(state.controller.status().state).toBe("ready")
  state.controller.dispose()
})

test("closing a saved preview keeps the background mounted", async () => {
  const state = fixture()
  await tick()
  const owner = Symbol()
  state.controller.preview(owner, { selection: "workshop:test" }, roster)
  state.controller.clearPreview(owner)
  expect(state.mounted).toHaveLength(1)
  expect(state.mounted[0]!.stopped).toBe(false)
  state.controller.dispose()
})

test("discarding an unsaved preview restores the saved background", async () => {
  const state = fixture({})
  await tick()
  const owner = Symbol()
  state.controller.preview(owner, { selection: "workshop:test" }, roster)
  expect(state.active()).toBe(true)
  state.controller.preview(owner, {}, roster)
  expect(state.active()).toBe(false)
  state.controller.clearPreview(owner)
  expect(state.mounted[0]!.stopped).toBe(true)
  state.controller.dispose()
})

test("a selection arriving before the roster still mounts once it resolves", async () => {
  let finish!: (value: WallpaperRoster) => void
  const state = fixture({}, { query: () => new Promise((resolve) => { finish = resolve }) })
  await tick()
  state.update({ selection: "workshop:test" })
  expect(state.mounted).toHaveLength(0)
  finish(roster)
  await tick()
  expect(state.mounted).toHaveLength(1)
  state.controller.dispose()
})

test("a late initial settings read cannot undo a newer saved selection", async () => {
  let finish!: (value: Record<string, unknown>) => void
  const state = fixture({}, { read: () => new Promise((resolve) => { finish = resolve }) })
  state.update({ selection: "workshop:test" })
  await tick()
  finish({})
  await tick()
  expect(state.mounted).toHaveLength(1)
  expect(state.mounted[0]!.stopped).toBe(false)
  state.controller.dispose()
})

test("an older roster response cannot replace a newer media URL", async () => {
  const state = fixture()
  await tick()
  const pending: Array<(value: WallpaperRoster) => void> = []
  state.query(() => new Promise((resolve) => { pending.push(resolve) }))
  state.update({ selection: "workshop:test" })
  state.update({ selection: "workshop:test" })
  pending[1]!({ ...roster, wallpapers: [{ ...wallpaper, entryUrl: "http://127.0.0.1:3/test.mp4" }] })
  await tick()
  pending[0]!(roster)
  await tick()
  expect(state.mounted.at(-1)?.url).toBe("http://127.0.0.1:3/test.mp4")
  expect(state.mounted).toHaveLength(2)
  state.controller.dispose()
})

test("new media URLs remount the same selection and mute changes apply", async () => {
  const state = fixture()
  await tick()
  state.query(async () => ({ ...roster, wallpapers: [{ ...wallpaper, entryUrl: "http://127.0.0.1:2/test.mp4" }] }))
  state.update({ selection: "workshop:test", muted: false })
  await tick()
  expect(state.mounted.at(-1)?.url).toBe("http://127.0.0.1:2/test.mp4")
  expect(state.mounted.at(-1)?.muted).toBe(false)
  state.controller.dispose()
})

test("pending queries cannot resurrect a disposed background", async () => {
  const state = fixture()
  await tick()
  let finish!: (value: WallpaperRoster) => void
  state.query(() => new Promise((resolve) => { finish = resolve }))
  state.update({ selection: "workshop:test" })
  state.controller.dispose()
  finish(roster)
  await tick()
  expect(state.active()).toBe(false)
  expect(state.mounted.every((layer) => layer.stopped)).toBe(true)
})

test("unsupported or missing wallpapers never enable transparency", async () => {
  const state = fixture({})
  await tick()
  state.controller.preview(Symbol(), { selection: "workshop:test" }, { ...roster, wallpapers: [{ ...wallpaper, supported: false, kind: "scene" }] })
  expect(state.active()).toBe(false)
  expect(state.mounted).toHaveLength(0)
  state.controller.dispose()
})
