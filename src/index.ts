/**
 * synergy-wallpapers — Wallpaper Engine integration for the Synergy Web UI.
 *
 * The plugin process discovers the local Wallpaper Engine install (Steam
 * Workshop + bundled projects), serves its media over a loopback HTTP server
 * run inside this process, exposes the roster through a UI-exposed query
 * operation, and persists the selection through declarative plugin settings.
 * The trusted settings component is the picker and mounts the background
 * layer in the Web UI. Only Synergy's own Web UI background changes — the
 * Windows desktop wallpaper is never touched.
 */

import { definePlugin, operation, settings, capability } from "@ericsanchezok/synergy-plugin"
import z from "zod"
import type { PluginActivationContext } from "@ericsanchezok/synergy-plugin"
import { DEFAULT_INSTALL_CONFIG, resolveInstall, scanRoster, type WallpaperInstallConfig } from "./server/roster.ts"
import { startMediaServer, type MediaRoots } from "./server/media-server.ts"
import type { WallpaperRoster } from "./server/types.ts"

/** The media server handle for the lifetime of the plugin process. */
let media: { url: string; stop(): Promise<void> } | undefined
/** The current install config (re-read from settings on each scan). */
let installConfig: WallpaperInstallConfig = DEFAULT_INSTALL_CONFIG
/** The current collection roots for the media server. */
let mediaRoots: MediaRoots = {}

const RosterInput = z.object({})

const RosterOutput = z.object({
  wallpapers: z.array(
    z.object({
      id: z.string(),
      collection: z.enum(["workshop", "bundled"]),
      title: z.string(),
      kind: z.enum(["scene", "video", "web", "unknown"]),
      supported: z.boolean(),
      previewUrl: z.string().nullable(),
      entryUrl: z.string().nullable(),
      properties: z.array(
        z.object({
          key: z.string(),
          text: z.string(),
          type: z.string(),
          value: z.union([z.string(), z.number(), z.boolean()]),
          options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
        }),
      ),
      contentRating: z.string().nullable(),
    }),
  ),
  steamRootsFound: z.boolean(),
  installFound: z.boolean(),
  mediaBase: z.string(),
})

export default definePlugin({
  id: "synergy-wallpapers",
  name: "Synergy Wallpapers",
  version: "0.1.0",
  description:
    "Dress Synergy's Web UI background with Wallpaper Engine wallpapers (the Windows desktop wallpaper is untouched)",
  author: "TTAWDTT",
  repository: "https://github.com/TTAWDTT/synergy-plugin-wallpapers",
  license: "MIT",
  icon: "./assets/icon.svg",
  keywords: ["wallpaper", "wallpaper engine", "background", "steam", "appearance"],
  capabilities: [capability("settings.read"), capability("settings.write")],
  contributions: [
    operation({
      id: "wallpapers.roster",
      type: "query",
      expose: ["ui"],
      input: RosterInput,
      output: RosterOutput,
      handler: async (_input, context): Promise<WallpaperRoster & { mediaBase: string }> => {
        if (context.settings) {
          try {
            const values = await context.settings.get()
            installConfig = {
              steamLibraryRoots:
                typeof values.steamLibraryRoots === "string" && values.steamLibraryRoots.trim().length > 0
                  ? values.steamLibraryRoots.split(/[;,\n]/).map((root) => root.trim()).filter((root) => root.length > 0)
                  : Array.isArray(values.steamLibraryRoots)
                    ? values.steamLibraryRoots.filter((root): root is string => typeof root === "string")
                    : DEFAULT_INSTALL_CONFIG.steamLibraryRoots,
              appId: typeof values.appId === "string" && values.appId.length > 0 ? values.appId : DEFAULT_INSTALL_CONFIG.appId,
              bundledProjectsSubPath:
                typeof values.bundledProjectsSubPath === "string" && values.bundledProjectsSubPath.length > 0
                  ? values.bundledProjectsSubPath
                  : DEFAULT_INSTALL_CONFIG.bundledProjectsSubPath,
            }
          } catch {
            installConfig = DEFAULT_INSTALL_CONFIG
          }
        }
        const roster = await scanRoster(media?.url ?? "", installConfig)
        const resolved = await resolveInstall(installConfig)
        mediaRoots = { workshop: resolved.workshop, bundled: resolved.bundled }
        return { ...roster, mediaBase: media?.url ?? "" }
      },
    }),
    settings({
      id: "wallpaper",
      label: "Wallpaper",
      group: "appearance",
      component: { source: "./src/ui/settings.tsx" },
      formSchema: {
        type: "object",
        properties: {
          steamLibraryRoots: {
            type: "string",
            title: "Steam library roots",
            description:
              "Semicolon-separated Steam library roots holding steamapps/libraryfolders.vdf. Empty detects automatically (Windows registry, standard locations).",
            default: "",
          },
          appId: {
            type: "string",
            title: "Wallpaper Engine app id",
            default: "431960",
          },
          bundledProjectsSubPath: {
            type: "string",
            title: "Bundled projects subpath",
            default: "projects/defaultprojects",
          },
        },
      },
    }),
  ],
  async activate(context: PluginActivationContext) {
    media = await startMediaServer(() => mediaRoots)
    context.log.info(`wallpaper media server on ${media.url}`)
  },
  async deactivate() {
    await media?.stop()
    media = undefined
  },
})
