import { onCleanup } from "solid-js"
import type { PluginSlotSurfaceContext } from "@ericsanchezok/synergy-plugin/ui"
import { acquireWallpaper } from "./wallpaper-controller.ts"
import "./wallpaper-layer.css"

export default function WallpaperBackground(props: { context: PluginSlotSurfaceContext }) {
  const wallpaper = acquireWallpaper(props.context)
  onCleanup(wallpaper.release)
  return null
}
