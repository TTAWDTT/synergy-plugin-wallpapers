type Values = Record<string, unknown>

const STORAGE_KEY = "synergy-wallpapers:wallpaper-state:v1"
const PERSISTED_KEYS = [
  "selection",
  "muted",
  "glassOpacity",
  "glassBlur",
  "wallpaperDim",
  "wallpaperBlur",
  "wallpaperTint",
  "steamLibraryRoots",
  "appId",
  "bundledProjectsSubPath",
] as const

function storage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    return undefined
  }
}

function pick(values: Values): Values {
  return Object.fromEntries(PERSISTED_KEYS.flatMap((key) => Object.prototype.hasOwnProperty.call(values, key) ? [[key, values[key]]] : []))
}

export function readWallpaperState(): Values {
  const raw = storage()?.getItem(STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? pick(parsed as Values) : {}
  } catch {
    return {}
  }
}

export function rememberWallpaperState(values: Values): Values {
  const next = pick(values)
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
  return next
}

export function mergeWallpaperState(values: Values, remembered: Values): Values {
  return Object.prototype.hasOwnProperty.call(values, "selection") ? values : { ...remembered, ...values }
}
