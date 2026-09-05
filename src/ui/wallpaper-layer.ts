import type { WallpaperSummary } from "../server/types.ts"

export const WEB_LOAD_TIMEOUT_MS = 15_000

export function applyTranslucentTokens(active: boolean): void {
  if (typeof document === "undefined") return
  document.documentElement.toggleAttribute("data-synergy-wallpaper-active", active)
}

export function mountWallpaperLayer(summary: WallpaperSummary, muted: boolean, onError: (message: string) => void = () => {}, onReady: () => void = () => {}): () => void {
  if (typeof document === "undefined" || !summary.supported || !summary.entryUrl || (summary.kind !== "video" && summary.kind !== "web")) return () => {}
  const layer = document.createElement("div")
  layer.dataset.synergyWallpaperLayer = ""
  layer.setAttribute("aria-hidden", "true")
  let media: HTMLVideoElement | HTMLIFrameElement
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let unwatchFrame: (() => void) | undefined
  const fail = () => {
    if (disposed) return
    const detail = media instanceof HTMLVideoElement ? media.error?.message : undefined
    onError(`无法播放“${summary.title}”。${detail || "请确认 Synergy 已更新到支持同源插件资源的版本，并检查媒体文件。"}`)
  }
  const ready = () => { if (!disposed) onReady() }
  const blocked = (event: SecurityPolicyViolationEvent) => {
    if (!disposed && summary.entryUrl && (event.blockedURI === new URL(summary.entryUrl, document.baseURI).href))
      onError("Synergy 的安全策略阻止了壁纸媒体。需要更新宿主的同源资源支持，不能通过放宽全局安全设置解决。")
  }
  document.addEventListener?.("securitypolicyviolation", blocked)
  if (summary.kind === "video") {
    const video = document.createElement("video")
    video.src = summary.entryUrl
    video.muted = muted
    video.loop = true
    video.autoplay = true
    video.playsInline = true
    video.disablePictureInPicture = true
    video.addEventListener("error", fail, { once: true })
    video.addEventListener("playing", ready, { once: true })
    media = video
  } else if (summary.kind === "web") {
    const frame = document.createElement("iframe")
    frame.src = summary.entryUrl
    frame.setAttribute("sandbox", "allow-scripts")
    frame.style.pointerEvents = "none"
    frame.setAttribute("title", "")
    frame.setAttribute("tabindex", "-1")
    timer = setTimeout(fail, WEB_LOAD_TIMEOUT_MS)
    const receive = (event: MessageEvent) => {
      if (disposed || event.source !== frame.contentWindow || event.data?.source !== "synergy-wallpapers") return
      if (event.data.state === "error") {
        clearTimeout(timer)
        onError(`网页壁纸“${summary.title}”不兼容：${String(event.data.message ?? "初始化失败").slice(0, 300)}。可先选择视频壁纸。`)
      } else if (event.data.state === "ready") {
        clearTimeout(timer)
        ready()
      }
    }
    document.defaultView?.addEventListener("message", receive)
    unwatchFrame = () => document.defaultView?.removeEventListener("message", receive)
    frame.addEventListener("error", fail, { once: true })
    media = frame
  } else return () => {}
  layer.appendChild(media)
  document.body.appendChild(layer)
  if (media instanceof HTMLVideoElement) void media.play().catch(fail)
  return () => {
    if (disposed) return
    disposed = true
    clearTimeout(timer)
    unwatchFrame?.()
    document.removeEventListener?.("securitypolicyviolation", blocked)
    if (media instanceof HTMLVideoElement) {
      media.pause()
      media.removeAttribute("src")
      media.load()
    }
    layer.remove()
  }
}
