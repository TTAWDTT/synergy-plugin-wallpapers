import { createSignal, createMemo, createEffect, onCleanup, onMount, For, Show } from "solid-js"
import type { Component } from "solid-js"
import type { PluginSettingsComponentProps } from "@ericsanchezok/synergy-plugin/ui"
import type { WallpaperRoster, WallpaperSummary } from "../server/types.ts"
import { parseSelection } from "../server/types.ts"
import { acquireWallpaper } from "./wallpaper-controller.ts"
import { APPEARANCE_PRESETS, DEFAULT_APPEARANCE, readAppearance } from "./appearance.ts"
import { mergeWallpaperState, readWallpaperState } from "./wallpaper-state.ts"
import "./wallpaper-layer.css"
import "./picker.css"

const PAGE_SIZE = 36
const filters = [{ id: "all", label: "全部可用" }, { id: "video", label: "视频" }, { id: "web", label: "网页" }] as const
type Filter = typeof filters[number]["id"]
const playable = (entry: WallpaperSummary) => entry.supported && entry.entryUrl !== null
const adjustments = [
  { key: "glassOpacity", label: "界面不透明度", hint: "越高越清晰，越低越通透", min: 40, max: 96, unit: "%" },
  { key: "glassBlur", label: "界面磨砂", hint: "只模糊侧栏、顶栏和输入区背后的画面", min: 0, max: 24, unit: "px" },
  { key: "wallpaperDim", label: "背景遮罩", hint: "深色主题压暗、浅色主题提亮，让正文更易读", min: 0, max: 65, unit: "%" },
  { key: "wallpaperBlur", label: "壁纸柔焦", hint: "降低背景细节，0 保留原始清晰度", min: 0, max: 8, unit: "px" },
] as const

const WallpaperSettings: Component<PluginSettingsComponentProps> = (props) => {
  const [roster, setRoster] = createSignal<WallpaperRoster>()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")
  const [query, setQuery] = createSignal("")
  const [tab, setTab] = createSignal<"library" | "appearance">("library")
  const [kind, setKind] = createSignal<Filter>("all")
  const [includeUnsupported, setIncludeUnsupported] = createSignal(false)
  const [limit, setLimit] = createSignal(PAGE_SIZE)
  const wallpaper = acquireWallpaper(props.context)
  const [status, setStatus] = createSignal(wallpaper.status())
  const unwatchStatus = wallpaper.subscribe(setStatus)
  let disposed = false
  let request = 0
  const remembered = readWallpaperState()
  const effectiveValues = () => mergeWallpaperState(props.values, remembered)
  const selection = () => {
    const value = effectiveValues().selection
    return typeof value === "string" ? value : ""
  }
  const muted = () => effectiveValues().muted !== false
  const appearance = () => readAppearance(effectiveValues())
  const all = () => roster()?.wallpapers ?? []
  const supportedCount = createMemo(() => all().filter(playable).length)
  const selected = createMemo(() => {
    const target = parseSelection(selection())
    return target ? all().find((entry) => entry.collection === target.collection && entry.id === target.id) : undefined
  })
  const results = createMemo(() => {
    const text = query().trim().toLowerCase()
    return all().filter((entry) => (includeUnsupported() || playable(entry)) &&
      (kind() === "all" || entry.kind === kind()) &&
      (!text || entry.title.toLowerCase().includes(text) || entry.id.includes(text)))
  })
  createEffect(() => { query(); kind(); includeUnsupported(); setLimit(PAGE_SIZE) })
  createEffect(() => { wallpaper.preview(props.values, roster()) })

  function write(next: Record<string, unknown>) {
    setError("")
    try {
      const result = props.onChange({ ...props.values, ...next })
      void Promise.resolve(result).catch((failure) => { if (!disposed) setError(String(failure)) })
    } catch (failure) { setError(String(failure)) }
  }

  function switchTab(event: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const next = event.key === "Home" ? "library" : event.key === "End" ? "appearance" : tab() === "library" ? "appearance" : "library"
    setTab(next)
    document.getElementById(`swp-${next}-tab`)?.focus()
  }

  async function load() {
    const current = ++request
    setLoading(true)
    setError("")
    try {
      const data = await props.context.operations.query<WallpaperRoster>("wallpapers.roster", {})
      if (!disposed && current === request) setRoster(data)
    } catch (failure) {
      if (!disposed && current === request) setError(`无法读取壁纸库：${String(failure)}`)
    } finally {
      if (!disposed && current === request) setLoading(false)
    }
  }
  onMount(() => { void load() })
  const unwatchSettings = props.context.settings.subscribe(() => { void load() })
  onCleanup(() => { disposed = true; unwatchSettings(); unwatchStatus(); wallpaper.release() })

  return <section class="synergy-wallpapers-picker" data-synergy-wallpapers-picker="">
    <header class="swp-header">
      <div><h2 class="swp-title">壁纸</h2><p class="swp-description">自动读取 Wallpaper Engine，点击缩略图即可预览。</p></div>
      <button type="button" class="swp-button" disabled={loading()} onClick={() => void load()}>{loading() ? "扫描中…" : "刷新壁纸库"}</button>
    </header>
    <div class="swp-current-panel">
      <div class="swp-current-image"><Show when={selected()?.previewUrl} fallback={<span aria-hidden="true">▧</span>}><img src={selected()?.previewUrl ?? undefined} alt="" /></Show></div>
      <div class="swp-current-copy"><span class="swp-eyebrow">当前壁纸</span><strong title={selected()?.title}>{selected()?.title ?? "未设置"}</strong><span class="swp-playback" classList={{ "swp-playback-error": status().state === "error" }} role="status">{status().message}</span></div>
      <Show when={selection()}><button type="button" class="swp-button swp-button-subtle" onClick={() => write({ selection: "" })}>关闭壁纸</button></Show>
    </div>
    <Show when={error() || status().state === "error"}><div class="swp-error" role="alert"><span>{error() || status().message}</span><button class="swp-button" type="button" onClick={() => { wallpaper.retry(); void load() }}>重试</button></div></Show>
    <div class="swp-tabs" role="tablist" aria-label="壁纸设置分页" onKeyDown={switchTab}>
      <button type="button" role="tab" id="swp-library-tab" aria-controls="swp-library-panel" aria-selected={tab() === "library"} tabIndex={tab() === "library" ? 0 : -1} onClick={() => setTab("library")}>壁纸库</button>
      <button type="button" role="tab" id="swp-appearance-tab" aria-controls="swp-appearance-panel" aria-selected={tab() === "appearance"} tabIndex={tab() === "appearance" ? 0 : -1} onClick={() => setTab("appearance")}>界面融合</button>
    </div>
    <Show when={tab() === "appearance"}>
      <div class="swp-appearance" id="swp-appearance-panel" role="tabpanel" aria-labelledby="swp-appearance-tab">
        <div class="swp-section-heading"><h3>让界面和壁纸使用同一种底色</h3><p>侧栏与顶栏通透，输入区更清晰，弹窗保留足够遮挡。调整即时预览，不会重播视频。</p></div>
        <div class="swp-presets" role="group" aria-label="融合预设"><For each={[...APPEARANCE_PRESETS]}>{(preset) => <button type="button" class="swp-preset" aria-pressed={Object.entries(preset.values).every(([key, value]) => appearance()[key as keyof typeof DEFAULT_APPEARANCE] === value)} onClick={() => write({ ...preset.values })}><strong>{preset.label}</strong><span>{preset.description}</span></button>}</For></div>
        <label class="swp-tint-toggle"><span><strong>跟随壁纸取色</strong><small>只在切换时提取柔和底色，保留主题的文字、警告和按钮颜色。</small></span><input type="checkbox" aria-label="跟随壁纸取色" checked={appearance().wallpaperTint} onChange={(event) => write({ wallpaperTint: event.currentTarget.checked })} /></label>
        <div class="swp-adjustments"><For each={[...adjustments]}>{(adjustment) => <label class="swp-adjustment"><span class="swp-adjustment-copy"><strong>{adjustment.label}</strong><small>{adjustment.hint}</small></span><span class="swp-range-control"><input type="range" aria-label={adjustment.label} min={adjustment.min} max={adjustment.max} step="1" value={appearance()[adjustment.key]} on:input={(event) => write({ [adjustment.key]: Number(event.currentTarget.value) })} /><output>{appearance()[adjustment.key]}{adjustment.unit}</output></span></label>}</For></div>
        <div class="swp-appearance-note"><span>沿用 Synergy 当前深浅主题；关闭壁纸或禁用插件后，界面恢复原样。</span><button type="button" class="swp-button" onClick={() => write({ ...DEFAULT_APPEARANCE })}>恢复默认融合</button></div>
      </div>
    </Show>
    <Show when={tab() === "library"}><div class="swp-library" id="swp-library-panel" role="tabpanel" aria-labelledby="swp-library-tab">
    <div class="swp-toolbar">
      <div class="swp-search-wrap"><span aria-hidden="true">⌕</span><input type="search" class="swp-search" aria-label="搜索壁纸" placeholder="搜索名称或创意工坊 ID" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} /></div>
      <div class="swp-filters" role="group" aria-label="壁纸类型"><For each={[...filters]}>{(filter) => <button type="button" class="swp-filter" aria-pressed={kind() === filter.id} onClick={() => setKind(filter.id)}>{filter.label}</button>}</For></div>
    </div>
    <div class="swp-library-meta"><span>{results().length} 个结果 · 共 {supportedCount()} 个可用</span><label class="swp-check"><input type="checkbox" checked={includeUnsupported()} onChange={(event) => setIncludeUnsupported(event.currentTarget.checked)} />显示不支持的壁纸</label></div>
    <Show when={roster() && !roster()!.installFound}><div class="swp-empty">没有自动检测到 Wallpaper Engine。请确认 Steam 库已安装该应用，然后刷新壁纸库。</div></Show>
    <Show when={!loading() && roster()?.installFound && results().length === 0}><div class="swp-empty">没有匹配的壁纸。试试其他名称或类型。</div></Show>
    <div class="swp-grid" role="group" aria-label="壁纸列表">
      <For each={results().slice(0, limit())}>{(entry) => {
        const id = `${entry.collection}:${entry.id}`
        const active = () => selection() === id
        return <button type="button" class="swp-card" aria-label={entry.title} aria-pressed={active()} disabled={!playable(entry)} onClick={() => write({ selection: id })}>
          <span class="swp-thumb"><span class="swp-thumb-placeholder" aria-hidden="true">▧</span><Show when={entry.previewUrl}><img class="swp-thumb-image" src={entry.previewUrl ?? undefined} alt="" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.visibility = "hidden" }} /></Show><span class="swp-type">{entry.kind === "video" ? "视频" : entry.kind === "web" ? "网页" : "不支持"}</span><Show when={active()}><span class="swp-selected-mark" aria-hidden="true">✓</span></Show></span>
          <span class="swp-card-copy"><span class="swp-name" title={entry.title}>{entry.title}</span><span class="swp-source">{entry.collection === "workshop" ? "创意工坊" : "内置壁纸"}</span></span>
        </button>
      }}</For>
    </div>
    <Show when={results().length > limit()}><button type="button" class="swp-button swp-more" onClick={() => setLimit(limit() + PAGE_SIZE)}>加载更多（已显示 {Math.min(limit(), results().length)} / {results().length}）</button></Show>
    </div></Show>
    <footer class="swp-footer"><label class="swp-check"><input type="checkbox" checked={!muted()} disabled={selected()?.kind !== "video"} onChange={(event) => write({ muted: !event.currentTarget.checked })} />视频声音</label><span>选中即预览，点击 Synergy 的「保存更改」保留设置。</span></footer>
  </section>
}

export default WallpaperSettings
