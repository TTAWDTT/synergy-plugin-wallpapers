/**
 * Synergy Wallpaper Engine roster types — the public payload vocabulary the
 * plugin serves to its trusted UI. Ported from the dsh wallpapers plugin.
 */

/** Which Wallpaper Engine surface a wallpaper came from. */
export type WallpaperCollection = "workshop" | "bundled"

/** Wallpaper kinds the project.json `type` field carries. */
export type WallpaperKind = "scene" | "video" | "web" | "unknown"

/** Property definition a wallpaper publishes in its project.json. */
export interface WallpaperProperty {
  /** Property key (`applyUserProperties` argument). */
  readonly key: string
  /** Human-facing label from project.json; falls back to the key. */
  readonly text: string
  /** Property type as Wallpaper Engine declares it. */
  readonly type: string
  /** Default value in wire form (strings for color, numbers for slider). */
  readonly value: string | number | boolean
  /** Ordered choices for combo properties. */
  readonly options?: readonly { label: string; value: string }[]
}

/** One Wallpaper Engine wallpaper the roster reports. */
export interface WallpaperSummary {
  /** Stable identity: the workshop id, or the bundled directory name. */
  readonly id: string
  /** Where the wallpaper came from. */
  readonly collection: WallpaperCollection
  /** Title from project.json, or the id when absent. */
  readonly title: string
  /** Lowercase project.json `type`, `unknown` when unlisted. */
  readonly kind: WallpaperKind
  /** Whether the Web UI can actually play this kind (video or web). */
  readonly supported: boolean
  /** URL of the preview image, or null when project.json names none. */
  readonly previewUrl: string | null
  /** URL of the entry file (video/web), null when absent or unsupported. */
  readonly entryUrl: string | null
  /** User-adjustable properties the wallpaper publishes. */
  readonly properties: WallpaperProperty[]
  /** Raw `contentrating` from project.json, or null. */
  readonly contentRating: string | null
}

/** The roster the picker consumes. */
export interface WallpaperRoster {
  readonly wallpapers: WallpaperSummary[]
  readonly steamRootsFound: boolean
  readonly installFound: boolean
}

/**
 * Split one stored selection value into its collection and id halves.
 * @param selection - the stored `<collection>:<id>` value.
 * @returns the pair, or undefined when the value is empty or malformed.
 */
export function parseSelection(selection: string): { collection: string; id: string } | undefined {
  if (selection.length === 0) return undefined
  const at = selection.indexOf(":")
  if (at <= 0 || at === selection.length - 1) return undefined
  const collection = selection.slice(0, at)
  return collection === "workshop" || collection === "bundled"
    ? { collection, id: selection.slice(at + 1) }
    : undefined
}
