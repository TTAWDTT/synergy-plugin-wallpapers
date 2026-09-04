/**
 * Wallpaper Engine install resolution and roster scanning for the Synergy
 * plugin process. Ported from the dsh wallpapers host service: the roster is
 * re-read on every call because Workshop items arrive and disappear outside
 * this process, and serving resolves the requested id against the same fresh
 * read.
 */

import { access } from "node:fs/promises"
import { join, resolve } from "node:path"
import {
  detectSteamRoots,
  discoverWallpaperEngineLibraries,
  parseProperties,
  readProjectJson,
  scanCollection,
  wallpaperKind,
  WALLPAPER_ENGINE_APP_ID,
} from "./discovery.ts"
import type { MediaRoots } from "./media-server.ts"
import { mediaUrl } from "./media-server.ts"
import type { WallpaperProperty, WallpaperRoster, WallpaperSummary } from "./types.ts"

/** Host-installation config the plugin's declarative settings carry. */
export interface WallpaperInstallConfig {
  /**
   * Steam installation roots holding `steamapps/libraryfolders.vdf`. Empty
   * (the default) enables detection: the Windows registry
   * `HKCU\Software\Valve\Steam\SteamPath`, then standard install locations.
   */
  steamLibraryRoots: string[]
  /** Wallpaper Engine Steam app id. */
  appId: string
  /** Bundled-projects directory under the Wallpaper Engine install. */
  bundledProjectsSubPath: string
}

export const DEFAULT_INSTALL_CONFIG: WallpaperInstallConfig = {
  steamLibraryRoots: [],
  appId: WALLPAPER_ENGINE_APP_ID,
  bundledProjectsSubPath: "projects/defaultprojects",
}

/**
 * Re-resolve the Wallpaper Engine install from the configured Steam roots,
 * falling back to unconfigured detection when none are configured. The
 * install path is derived, not configured: `libraryfolders.vdf` already
 * locates the library owning the app id, and the install is that library's
 * `steamapps/common/wallpaper_engine`.
 * @param config - install config from the plugin's settings.
 * @returns the collection roots, or empty flags when nothing resolved.
 */
export async function resolveInstall(config: WallpaperInstallConfig): Promise<MediaRoots & {
  steamRootsFound: boolean
}> {
  const configuredRoots = config.steamLibraryRoots
  const roots = configuredRoots.length > 0 ? configuredRoots : await detectSteamRoots()
  for (const steamRoot of roots) {
    const libraries = await discoverWallpaperEngineLibraries(steamRoot, config.appId)
    for (const library of libraries) {
      const install = join(library, "steamapps", "common", "wallpaper_engine")
      const workshopRoot = join(install, "..", "..", "..", "steamapps", "workshop", "content", config.appId)
      const bundledRoot = join(install, ...config.bundledProjectsSubPath.split(/[\\/]+/))
      try {
        await access(bundledRoot)
      } catch {
        continue
      }
      return {
        workshop: resolve(workshopRoot),
        bundled: resolve(bundledRoot),
        steamRootsFound: true,
      }
    }
  }
  return { steamRootsFound: roots.length > 0 }
}

/**
 * Build one public summary from a project.json.
 * @param mediaBase - the loopback media server root URL.
 * @param collection - which collection the wallpaper came from.
 * @param id - wallpaper id (directory name).
 * @param projectPath - absolute path of its project.json.
 */
async function summarize(
  mediaBase: string, collection: "workshop" | "bundled", id: string, projectPath: string,
): Promise<WallpaperSummary> {
  const project = await readProjectJson(projectPath)
  const kind = wallpaperKind(project?.type)
  const title = typeof project?.title === "string" && project.title.length > 0 ? project.title : id
  const file = typeof project?.file === "string" ? project.file : null
  const preview = typeof project?.preview === "string" ? project.preview : null
  const supported = kind === "video" || kind === "web"
  const properties: WallpaperProperty[] = parseProperties(project?.general)
  return {
    id,
    collection,
    title,
    kind,
    supported,
    previewUrl:
      preview === null ? null : mediaUrl(mediaBase, collection, id, preview),
    entryUrl: file === null || !supported ? null : mediaUrl(mediaBase, collection, id, file),
    properties,
    contentRating: typeof project?.contentrating === "string" ? project.contentrating : null,
  }
}

/**
 * Read every wallpaper once: bundled projects first (deployment-owned,
 * stable ids), then the Workshop (user-owned, numeric ids).
 * @param mediaBase - loopback media server root URL.
 * @param config - install config from the plugin's settings.
 */
export async function scanRoster(mediaBase: string, config: WallpaperInstallConfig): Promise<WallpaperRoster> {
  const install = await resolveInstall(config)
  const wallpapers: WallpaperSummary[] = []
  if (install.bundled !== undefined) {
    for (const entry of await scanCollection(install.bundled, "bundled")) {
      wallpapers.push(await summarize(mediaBase, "bundled", entry.id, entry.projectPath))
    }
  }
  if (install.workshop !== undefined) {
    for (const entry of await scanCollection(install.workshop, "workshop")) {
      wallpapers.push(await summarize(mediaBase, "workshop", entry.id, entry.projectPath))
    }
  }
  return {
    wallpapers,
    steamRootsFound: install.steamRootsFound,
    installFound: install.bundled !== undefined,
  }
}

/** Re-exports the roster schema-building code needs. */
export { WALLPAPER_ENGINE_APP_ID, readProjectJson, wallpaperKind }
