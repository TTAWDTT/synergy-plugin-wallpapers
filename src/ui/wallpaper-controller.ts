import type { PluginSurfaceContext } from "@ericsanchezok/synergy-plugin/ui"
import { parseSelection, type WallpaperRoster, type WallpaperSummary } from "../server/types.ts"
import { applyTranslucentTokens, mountWallpaperLayer } from "./wallpaper-layer.ts"
import { createAppearanceController, readAppearance } from "./appearance.ts"
import { mergeWallpaperState, readWallpaperState, rememberWallpaperState } from "./wallpaper-state.ts"

export type WallpaperPlaybackStatus = { state: "idle" | "loading" | "ready" | "error"; message: string }

type Values = Record<string, unknown>
type Renderer = {
  translucent(active: boolean): void
  mount(summary: WallpaperSummary, muted: boolean, onError: (message: string) => void, onReady: () => void): () => void
}
type WallpaperPersistence = {
  read(): Values
  write(values: Values): Values
}

export function createWallpaperController(
  context: PluginSurfaceContext,
  renderer: Renderer = { translucent: applyTranslucentTokens, mount: mountWallpaperLayer },
  appearance = createAppearanceController(),
  persistence: WallpaperPersistence = { read: readWallpaperState, write: rememberWallpaperState },
) {
  let status: WallpaperPlaybackStatus = { state: "idle", message: "未启用壁纸" }
  const listeners = new Set<(status: WallpaperPlaybackStatus) => void>()
  function report(next: WallpaperPlaybackStatus) {
    status = next
    for (const listener of listeners) listener(next)
  }
  let saved: Values = {}
  let remembered = persistence.read()
  let roster: WallpaperRoster | undefined
  let disposed = false
  let revision = 0
  let request = 0
  let lastKey = ""
  let playback = 0
  let stopLayer: (() => void) | undefined
  const previews = new Map<symbol, { values: Values; roster?: WallpaperRoster }>()

  function sync() {
    if (disposed) return
    const preview = Array.from(previews.values()).at(-1)
    const rawValues = preview?.values ?? saved
    const values = mergeWallpaperState(rawValues, remembered)
    const available = preview?.roster ?? roster
    const selection = parseSelection(typeof values.selection === "string" ? values.selection : "")
    const selected = selection && available?.wallpapers.find((entry) => entry.id === selection.id && entry.collection === selection.collection)
    const playable = selected?.supported && selected.entryUrl && (selected.kind === "video" || selected.kind === "web") ? selected : undefined
    const muted = typeof values.muted === "boolean" ? values.muted : true
    const key = playable ? JSON.stringify([playable.collection, playable.id, playable.kind, playable.entryUrl, muted]) : ""
    if (!playable) appearance.clear()
    else if (key !== lastKey || status.state !== "error") appearance.apply(readAppearance(values), playable.previewUrl)
    if (key === lastKey) return
    lastKey = key
    const currentPlayback = ++playback
    let failed = false
    stopLayer?.()
    stopLayer = undefined
    renderer.translucent(false)
    if (!playable) {
      report({ state: "idle", message: "未启用壁纸" })
      return
    }
    report({ state: "loading", message: "正在加载壁纸…" })
    stopLayer = renderer.mount(playable, muted, (message) => {
      if (disposed || currentPlayback !== playback || failed) return
      failed = true
      stopLayer?.()
      stopLayer = undefined
      renderer.translucent(false)
      appearance.clear()
      report({ state: "error", message })
    }, () => {
      if (disposed || currentPlayback !== playback || failed) return
      renderer.translucent(true)
      report({ state: "ready", message: playable.kind === "video" ? "视频正在播放" : "网页壁纸已载入" })
    })
    if (failed) { stopLayer?.(); stopLayer = undefined }
  }

  async function refresh() {
    const current = ++request
    try {
      const next = await context.operations.query<WallpaperRoster>("wallpapers.roster", {})
      if (disposed || current !== request) return
      roster = next
      sync()
    } catch (error) {
      if (disposed || current !== request) return
      report({ state: "error", message: `读取壁纸失败：${error instanceof Error ? error.message : String(error)}` })
    }
  }

  const adoptSaved = (values: Values) => {
    if (Object.prototype.hasOwnProperty.call(values, "selection")) remembered = persistence.write(values)
    saved = values
    sync()
  }
  const unsubscribe = context.settings.subscribe((values) => {
    revision++
    adoptSaved(values)
    void refresh()
  })
  const initialRevision = revision
  void context.settings.get().then((values) => {
    if (disposed || revision !== initialRevision) return
    adoptSaved(values)
    void refresh()
  }).catch((error) => {
    if (!disposed && revision === initialRevision) report({ state: "error", message: `读取壁纸设置失败：${String(error)}` })
  })

  return {
    status: () => status,
    subscribe(listener: (status: WallpaperPlaybackStatus) => void) {
      listeners.add(listener)
      listener(status)
      return () => { listeners.delete(listener) }
    },
    retry() { lastKey = ""; sync() },
    preview(owner: symbol, values: Values, available?: WallpaperRoster) {
      if (disposed) return
      previews.set(owner, { values, roster: available })
      sync()
    },
    clearPreview(owner: symbol) {
      previews.delete(owner)
      sync()
    },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      previews.clear()
      listeners.clear()
      stopLayer?.()
      stopLayer = undefined
      renderer.translucent(false)
      appearance.dispose()
    },
  }
}

const controllers = new Map<string, { controller: ReturnType<typeof createWallpaperController>; users: number }>()

export function acquireWallpaper(context: PluginSurfaceContext) {
  const key = JSON.stringify([context.pluginId, context.scopeId])
  let entry = controllers.get(key)
  if (!entry) {
    entry = { controller: createWallpaperController(context), users: 0 }
    controllers.set(key, entry)
  }
  const current = entry
  const owner = Symbol()
  current.users++
  let released = false
  return {
    status: current.controller.status,
    subscribe: current.controller.subscribe,
    retry: current.controller.retry,
    preview(values: Values, roster?: WallpaperRoster) {
      if (!released) current.controller.preview(owner, values, roster)
    },
    release() {
      if (released) return
      released = true
      current.controller.clearPreview(owner)
      if (--current.users !== 0) return
      current.controller.dispose()
      controllers.delete(key)
    },
  }
}
