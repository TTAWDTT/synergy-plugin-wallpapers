export type Appearance = {
  glassOpacity: number
  glassBlur: number
  wallpaperDim: number
  wallpaperBlur: number
  wallpaperTint: boolean
}

export const DEFAULT_APPEARANCE: Appearance = { glassOpacity: 76, glassBlur: 16, wallpaperDim: 28, wallpaperBlur: 0, wallpaperTint: true }
export const APPEARANCE_PRESETS = [
  { label: "清晰办公", description: "文字优先，背景更安静", values: { ...DEFAULT_APPEARANCE, glassOpacity: 90, wallpaperDim: 42, wallpaperBlur: 2 } },
  { label: "均衡融合", description: "通透但不影响阅读", values: DEFAULT_APPEARANCE },
  { label: "沉浸壁纸", description: "更多画面，更轻的界面", values: { ...DEFAULT_APPEARANCE, glassOpacity: 58, glassBlur: 20, wallpaperDim: 18 } },
] as const

function bounded(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback
}

export function readAppearance(values: Record<string, unknown>): Appearance {
  return {
    glassOpacity: bounded(values.glassOpacity, DEFAULT_APPEARANCE.glassOpacity, 40, 96),
    glassBlur: bounded(values.glassBlur, DEFAULT_APPEARANCE.glassBlur, 0, 24),
    wallpaperDim: bounded(values.wallpaperDim, DEFAULT_APPEARANCE.wallpaperDim, 0, 65),
    wallpaperBlur: bounded(values.wallpaperBlur, DEFAULT_APPEARANCE.wallpaperBlur, 0, 8),
    wallpaperTint: typeof values.wallpaperTint === "boolean" ? values.wallpaperTint : DEFAULT_APPEARANCE.wallpaperTint,
  }
}

export function paletteFromPixels(pixels: ArrayLike<number>): string {
  const buckets = new Map<number, { red: number; green: number; blue: number; weight: number }>()
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    const red = pixels[offset]!, green = pixels[offset + 1]!, blue = pixels[offset + 2]!
    const maximum = Math.max(red, green, blue), minimum = Math.min(red, green, blue)
    if (pixels[offset + 3]! < 128 || maximum < 35 || minimum > 230) continue
    const weight = 1 + (maximum - minimum) / 255
    const key = (Math.floor(red / 64) << 4) | (Math.floor(green / 64) << 2) | Math.floor(blue / 64)
    const bucket = buckets.get(key) ?? { red: 0, green: 0, blue: 0, weight: 0 }
    bucket.red += red * weight; bucket.green += green * weight; bucket.blue += blue * weight; bucket.weight += weight
    buckets.set(key, bucket)
  }
  const dominant = [...buckets.values()].sort((left, right) => right.weight - left.weight)[0]
  if (!dominant) return "rgb(112, 128, 144)"
  return `rgb(${Math.round(dominant.red / dominant.weight)}, ${Math.round(dominant.green / dominant.weight)}, ${Math.round(dominant.blue / dominant.weight)})`
}

export function loadWallpaperPalette(url: string, signal: AbortSignal): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (signal.aborted || typeof document === "undefined") { resolve(undefined); return }
    const image = new Image()
    let finished = false
    const finish = (color?: string) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      signal.removeEventListener("abort", abort)
      image.onload = null; image.onerror = null
      image.removeAttribute("src")
      resolve(color)
    }
    const abort = () => finish()
    const timeout = setTimeout(abort, 5_000)
    signal.addEventListener("abort", abort, { once: true })
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas")
        canvas.width = 24; canvas.height = 24
        const context = canvas.getContext("2d", { willReadFrequently: true })
        if (!context) { finish(); return }
        context.drawImage(image, 0, 0, 24, 24)
        finish(paletteFromPixels(context.getImageData(0, 0, 24, 24).data))
      } catch { finish() }
    }
    image.onerror = abort
    image.src = url
  })
}

export function createAppearanceController(options: {
  style?: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">
  palette?: typeof loadWallpaperPalette
} = {}) {
  const style = options.style ?? (typeof document === "undefined" ? undefined : document.documentElement.style)
  const sample = options.palette ?? loadWallpaperPalette
  const properties = ["opacity", "glass-blur", "veil", "wallpaper-blur", "accent", "tint"]
  let request: AbortController | undefined
  let lastPreview: string | undefined
  let active = false
  const cache = new Map<string, string>()
  function clear() {
    active = false
    request?.abort(); request = undefined; lastPreview = undefined
    for (const property of properties) style?.removeProperty(`--swp-fusion-${property}`)
  }
  return {
    apply(appearance: Appearance, previewUrl: string | null) {
      active = true
      style?.setProperty("--swp-fusion-opacity", `${appearance.glassOpacity}%`)
      style?.setProperty("--swp-fusion-glass-blur", `${appearance.glassBlur}px`)
      style?.setProperty("--swp-fusion-veil", `${appearance.wallpaperDim}%`)
      style?.setProperty("--swp-fusion-wallpaper-blur", `${appearance.wallpaperBlur}px`)
      style?.setProperty("--swp-fusion-tint", appearance.wallpaperTint ? "14%" : "0%")
      const preview = appearance.wallpaperTint ? previewUrl ?? "" : ""
      if (preview === lastPreview) return
      request?.abort(); lastPreview = preview
      style?.setProperty("--swp-fusion-accent", cache.get(preview) ?? "rgb(112, 128, 144)")
      if (!preview || cache.has(preview)) return
      const current = new AbortController()
      request = current
      void sample(preview, current.signal).then((color) => {
        if (!active || current.signal.aborted || request !== current || !color) return
        if (cache.size >= 24) cache.delete(cache.keys().next().value!)
        cache.set(preview, color)
        style?.setProperty("--swp-fusion-accent", color)
      }).catch(() => {})
    },
    clear,
    dispose() { clear(); cache.clear() },
  }
}
