/**
 * The Synergy wallpaper background stage: one fixed, pointer-transparent
 * element behind everything on `document.body` that plays the selected
 * Wallpaper Engine video (`<video>`) or web (`<iframe>`) wallpaper. The
 * layer exists only while a supported wallpaper is selected. This stage
 * lives entirely inside the Synergy Web UI — the Windows desktop is never
 * touched.
 */

import type { WallpaperSummary } from "../server/types.ts"

/** How long a web wallpaper's iframe gets to fire its load event (ms). */
export const WEB_LOAD_TIMEOUT_MS = 15_000

/**
 * Apply the translucent-theme override so the wallpaper shows through the
 * app shell, and retract it when the layer stops. Synergy paints its shell
 * from `--background-base` / `--background-stronger` and the workbench token
 * aliases; both schemes get the same translucent values.
 */
export const TRANSLUCENT_TOKENS = {
  "--background-base": { light: "transparent", dark: "transparent" },
  "--background-stronger": { light: "transparent", dark: "transparent" },
  "--workbench-panel-bg": { light: "rgba(255, 255, 255, 0.72)", dark: "rgba(24, 24, 27, 0.72)" },
  "--workbench-card-bg": { light: "rgba(255, 255, 255, 0.82)", dark: "rgba(24, 24, 27, 0.82)" },
  "--workbench-canvas-bg": { light: "rgba(255, 255, 255, 0.55)", dark: "rgba(24, 24, 27, 0.55)" },
  "--workbench-popover-bg": { light: "rgba(255, 255, 255, 0.92)", dark: "rgba(24, 24, 27, 0.92)" },
} as const

/**
 * Apply or retract the translucent-theme override on the document root.
 * @param active - whether a wallpaper is playing.
 */
export function applyTranslucentTokens(active: boolean): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  const dark = root.getAttribute("data-color-scheme") === "dark"
  for (const [token, modes] of Object.entries(TRANSLUCENT_TOKENS)) {
    if (active) root.style.setProperty(token, dark ? modes.dark : modes.light)
    else root.style.removeProperty(token)
  }
}

/**
 * Mount the background layer for one selected wallpaper.
 * @param summary - the selected wallpaper's roster row.
 * @param muted - whether the layer's audio starts muted.
 * @returns disposer removing the layer element.
 */
export function mountWallpaperLayer(summary: WallpaperSummary, muted: boolean): () => void {
  if (typeof document === "undefined") return () => {}
  const layer = document.createElement("div")
  layer.dataset.synergyWallpaperLayer = ""
  layer.setAttribute("aria-hidden", "true")
  let media: HTMLVideoElement | HTMLIFrameElement | undefined
  if (summary.kind === "video" && summary.entryUrl !== null) {
    const video = document.createElement("video")
    video.src = summary.entryUrl
    video.muted = muted
    video.loop = true
    video.autoplay = true
    video.playsInline = true
    video.disablePictureInPicture = true
    media = video
  } else if (summary.kind === "web" && summary.entryUrl !== null) {
    const frame = document.createElement("iframe")
    frame.src = summary.entryUrl
    // Workshop web wallpapers are arbitrary user HTML/JS served same-origin,
    // so the sandbox must stay an opaque origin: `allow-same-origin` joining
    // `allow-scripts` would hand the frame its full origin privileges back
    // (parent DOM, cookies, credentialed API calls).
    frame.setAttribute("sandbox", "allow-scripts")
    // The layer is pointer-transparent; the frame inside it must not become
    // an interaction sink the rest of the app cannot see.
    frame.style.pointerEvents = "none"
    frame.setAttribute("title", "")
    frame.setAttribute("tabindex", "-1")
    media = frame
    const timer = setTimeout(() => {
      frame.src = ""
    }, WEB_LOAD_TIMEOUT_MS)
    frame.addEventListener("load", () => {
      clearTimeout(timer)
    }, { once: true })
  }
  if (media === undefined) return () => {}
  layer.appendChild(media)
  document.body.appendChild(layer)
  if (media instanceof HTMLVideoElement) {
    void media.play().catch(() => {})
  }
  return () => {
    layer.remove()
  }
}
