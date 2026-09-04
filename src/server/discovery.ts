/**
 * Wallpaper Engine discovery: Steam library roots from `libraryfolders.vdf`,
 * the Wallpaper Engine install under the library owning app 431960, workshop
 * content, bundled defaultprojects, and `project.json` parsing.
 *
 * Plain-text VDF parsing (no dependency): the file nests braces with
 * quoted key-value pairs, and every field discovery reads is a quoted scalar
 * whose value never contains a quote, so a tokenizer over quotes, braces, and
 * whitespace is exact for this input.
 * @module discovery
 */

import { access, readdir, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { WallpaperCollection, WallpaperKind, WallpaperProperty } from './types.ts'

const execFileAsync = promisify(execFile)

/** Wallpaper Engine's Steam app id. */
export const WALLPAPER_ENGINE_APP_ID = '431960'

/** VDF key Steam writes under every library folder entry. */
const VDF_PATH_KEY = 'path'
/** VDF table Steam writes the library list under. */
const VDF_ROOT_KEY = 'libraryfolders'

/** One wallpaper entry a directory scan produced. */
export interface DiscoveredWallpaper {
  readonly collection: WallpaperCollection
  readonly id: string
  readonly projectPath: string
}

/**
 * Parse every `path` value in `libraryfolders.vdf`, in file order.
 * @param vdf - file text.
 * @returns library root paths with escaped backslashes folded.
 */
export function parseLibraryRoots(vdf: string): string[] {
  const roots: string[] = []
  const at = vdf.indexOf(`"${VDF_ROOT_KEY}"`)
  const body = at === -1 ? vdf : vdf.slice(at)
  const pairs = body.matchAll(new RegExp(`"${VDF_PATH_KEY}"\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g'))
  for (const pair of pairs) {
    // VDF escapes `\` as `\\`; Steam itself also tolerates single ones, and
    // folding both through JSON.parse accepts either.
    const raw = pair[1] ?? ''
    try {
      roots.push(JSON.parse(`"${raw}"`) as string)
    } catch {
      roots.push(raw.replaceAll('\\\\', '\\'))
    }
  }
  return roots
}

/**
 * Read the Steam library roots that own Wallpaper Engine.
 * @param steamRoot - Steam root containing `steamapps`.
 * @param appId - Steam app id to look up (defaults to Wallpaper Engine's).
 * @returns library roots where the app is installed, in file order.
 */
export async function discoverWallpaperEngineLibraries(
  steamRoot: string, appId: string = WALLPAPER_ENGINE_APP_ID,
): Promise<string[]> {
  const vdfPath = join(steamRoot, 'steamapps', 'libraryfolders.vdf')
  let vdf: string
  try {
    vdf = await readFile(vdfPath, 'utf8')
  } catch {
    return []
  }
  const text = vdf.replaceAll('\t', ' ')
  const roots: string[] = []
  // Split at each `path` pair, then ask whether the table that follows owns
  // the app id: the `apps` table always comes after its folder's `path`.
  const marker = new RegExp(`"${VDF_PATH_KEY}"\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g')
  const matches = [...text.matchAll(marker)]
  const adopt = (raw: string, segment: string): void => {
    if (!segment.includes(`"${appId}"`)) return
    let root: string
    try {
      root = JSON.parse(`"${raw}"`) as string
    } catch {
      root = raw.replaceAll('\\\\', '\\')
    }
    roots.push(root)
  }
  // Walk with the previous match as the anchor: the region from a `path`
  // pair up to the next one (or the end of the file) is the table that may
  // contain the app id. This avoids indexed lookahead, on which the lint
  // and type models disagree.
  let anchor: { index: number; raw: string } | undefined
  for (const match of matches) {
    if (anchor !== undefined) adopt(anchor.raw, text.slice(anchor.index, match.index))
    anchor = { index: match.index, raw: match[1] ?? '' }
  }
  if (anchor !== undefined) adopt(anchor.raw, text.slice(anchor.index))
  return roots
}

/**
 * Classify one wallpaper's `project.json` `type` field.
 * @param raw - the field value, or undefined when absent.
 * @returns the lowercase kind, `unknown` for anything unlisted.
 */
export function wallpaperKind(raw: unknown): WallpaperKind {
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return text === 'scene' || text === 'video' || text === 'web' ? text : 'unknown'
}

/** Property types whose value reaches the browser unchanged. */
const KNOWN_PROPERTY_TYPES: ReadonlySet<string> = new Set([
  'bool', 'slider', 'color', 'text', 'combo', 'textinput', 'group', 'usershortcut',
])

/** Whether one parsed properties table entry is user-adjustable. */
function isAdjustable(entry: unknown): entry is { type: string; value: unknown; text?: unknown; options?: unknown } {
  if (typeof entry !== 'object' || entry === null) return false
  const record = entry as { type?: unknown; value?: unknown; text?: unknown; options?: unknown }
  if (typeof record.type !== 'string' || !KNOWN_PROPERTY_TYPES.has(record.type)) return false
  // The Wallpaper Engine UI hides usershortcut rows behind a per-user hotkey
  // binding dsh cannot render; everything else with a declared value is shown.
  if (record.type === 'usershortcut') return false
  return typeof record.value === 'string' || typeof record.value === 'number' || typeof record.value === 'boolean'
}

/**
 * Extract the user-adjustable properties from one project.json.
 * @param general - the parsed `general` object, or undefined.
 * @returns properties in project.json order, `schemecolor` first like the
 * Wallpaper Engine UI does when an order field is absent.
 */
export function parseProperties(general: unknown): WallpaperProperty[] {
  const table = (general as { properties?: unknown } | undefined)?.properties
  if (typeof table !== 'object' || table === null) return []
  const properties: (WallpaperProperty & { order: number })[] = []
  let index = 0
  for (const [key, entry] of Object.entries(table as Record<string, unknown>)) {
    if (!isAdjustable(entry)) continue
    const order = typeof (entry as { order?: unknown }).order === 'number'
      ? (entry as unknown as { order: number }).order
      : index
    properties.push({
      key,
      text: typeof (entry as { text?: unknown }).text === 'string'
        ? (entry as { text: string }).text
        : key,
      type: entry.type,
      value: entry.value as string | number | boolean,
      ...(entry.type === 'combo' && Array.isArray((entry as { options?: unknown }).options)
        ? {
          options: ((entry as { options: unknown[] }).options)
            .filter(option => typeof option === 'object' && option !== null
              && typeof (option as { label?: unknown }).label === 'string'
              && typeof (option as { value?: unknown }).value === 'string')
            .map(option => ({
              label: (option as { label: string }).label,
              value: (option as { value: string }).value,
            })),
        }
        : {}),
      order,
    })
    index += 1
  }
  return properties
    .sort((left, right) => left.order - right.order)
    .map(({ order: _order, ...property }) => property)
}

/**
 * Parse one wallpaper directory's `project.json`.
 * @param projectPath - absolute path of the file.
 * @returns the parsed JSON object, or undefined when absent or unreadable.
 */
export async function readProjectJson(projectPath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await readFile(projectPath, 'utf8')
    // Wallpaper Engine writes plain UTF-8; a BOM survives some editors, and
    // JSON.parse rejects it, so strip one before parsing.
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * Scan one collection directory for wallpaper directories.
 * @param root - absolute directory whose immediate children are wallpapers.
 * @param collection - which collection the scan serves.
 * @returns one entry per child carrying a `project.json`, sorted by id.
 */
export async function scanCollection(root: string, collection: WallpaperCollection): Promise<DiscoveredWallpaper[]> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return []
  }
  const found = await Promise.all(names.map(async (id): Promise<DiscoveredWallpaper | undefined> => {
    const projectPath = join(root, id, 'project.json')
    const project = await readProjectJson(projectPath)
    return project === undefined ? undefined : { collection, id, projectPath }
  }))
  return found
    .filter((entry): entry is DiscoveredWallpaper => entry !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id))
}

/** Whether one candidate directory is a Steam root: it holds `steamapps`. */
async function isSteamRoot(candidate: string): Promise<boolean> {
  try {
    await access(join(candidate, 'steamapps'))
    return true
  } catch {
    return false
  }
}

/**
 * Parse one `reg query ... /v SteamPath` stdout.
 * @param stdout - the reg tool's output text.
 * @returns the Steam path with Steam's forward slashes folded to backslashes,
 * or undefined when no value line is present.
 */
export function parseRegSteamPath(stdout: string): string | undefined {
  const match = /SteamPath\s+REG_SZ\s+(.+)/.exec(stdout)
  const raw = match?.[1]?.trim()
  return raw === undefined || raw === '' ? undefined : raw.replaceAll('/', '\\')
}

/**
 * Windows-only: read `HKCU\Software\Valve\Steam\SteamPath` via `reg query`.
 * The registry write is part of every Steam install, so this resolves the
 * root even when Steam sits outside the usual Program Files location.
 * @returns the Steam root, or undefined when reg is absent or the key is.
 */
async function windowsSteamPath(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'])
    // Output lines carry `<name>    <type>    <value>`; the value is the last
    // whitespace-separated token, and Steam writes it with forward slashes.
    return parseRegSteamPath(stdout)
  } catch {
    return undefined
  }
}

/**
 * Detect Steam's installation root without configuration: the Windows
 * registry (via `reg query`), then the standard install locations per
 * platform. Every known library — not just the root's own — is still found
 * afterwards through `libraryfolders.vdf`, so only the first root has to be
 * right.
 * @returns candidate Steam roots in probe order, deduplicated.
 */
export async function detectSteamRoots(): Promise<string[]> {
  const candidates: string[] = []
  if (platform() === 'win32') {
    const registry = await windowsSteamPath()
    if (registry !== undefined) candidates.push(registry)
    candidates.push(
      join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam'),
      join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Steam'),
    )
  } else if (process.platform === 'darwin') {
    candidates.push(join(homedir(), 'Library', 'Application Support', 'Steam'))
  } else {
    candidates.push(join(homedir(), '.steam', 'steam'), join(homedir(), '.local', 'share', 'Steam'))
  }
  const checked = await Promise.all(candidates.map(async candidate =>
    await isSteamRoot(candidate) ? candidate : undefined))
  const roots = checked.filter((root): root is string => root !== undefined)
  return [...new Set(roots)]
}
