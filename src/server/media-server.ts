/**
 * Loopback media server for wallpaper files. Synergy's plugin asset route
 * only serves build-time packaged files, so the plugin process runs its own
 * node:http server on 127.0.0.1 and serves wallpaper media itself. This is
 * the Web-UI background only — the Windows desktop wallpaper is never
 * touched.
 *
 * Security posture (ported from the dsh plugin's hardenings):
 * - the server binds the loopback interface only;
 * - traversal is rejected before resolving: an id carrying path semantics
 *   (`.`/`..`, separators, drive-absolute forms) answers 403, and the
 *   resolved target must stay anchored at the collection root;
 * - permissive CORS is safe here because the files are user-chosen media
 *   from the local Wallpaper Engine install.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { extname, join, resolve, sep } from "node:path"
import type { WallpaperSummary } from "./types.ts"
import { serveFileWithRanges } from "./file-stream.ts"

/** MIME types the media routes need. */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

/** The host-resolved collection roots the server serves from. */
export interface MediaRoots {
  workshop?: string
  bundled?: string
}

/**
 * Serve one media request against the current collection roots.
 * Exported for tests: the guard sequence is the security-critical part.
 * @param roots - current collection roots.
 * @param decoded - decoded URL pathname under the prefix.
 * @param req - incoming request.
 * @param res - response to own.
 */
export function serveMedia(roots: MediaRoots, decoded: string, req: IncomingMessage, res: ServerResponse): void {
  const segments = decoded.split("/").filter((segment) => segment.length > 0)
  // [wallpapers, <collection>, <id>, ...rest]; the filter above bounds the
  // indexes, so the segment reads destructure safely.
  const [, collection = "", id = ""] = segments
  if (collection === "" || id === "") {
    res.writeHead(404)
    res.end()
    return
  }
  const root = collection === "workshop" ? roots.workshop : collection === "bundled" ? roots.bundled : undefined
  if (root === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  // The id is a scanned directory name (a Workshop numeric id or a bundled
  // project folder), so it never needs path semantics. Reject any id that
  // carries them BEFORE resolving: `..`, separators, and drive-absolute
  // forms would otherwise climb out of or replace the collection root
  // (`resolve(root, 'C:\\x')` drops `root` entirely). The `resolve !== join`
  // arm folds the residual Windows cases (`.`-relative drives, trailing
  // separators) the explicit checks miss.
  if (
    id === "." || id === ".." || id.includes("/") || id.includes("\\")
    || resolve(root, id) !== join(root, id)
  ) {
    res.writeHead(403)
    res.end()
    return
  }
  // Traversal rejection over the decoded path: a `%2e%2e` leaves the URL
  // parser before this point, so the check runs on the decoded form, with
  // `sep` for Windows backslash targets. The guard anchors at the collection
  // root, so no suffix segment can step above it even when `id` itself is
  // long.
  const target = resolve(root, id, ...segments.slice(3))
  if (!target.startsWith(root + sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  serveFileWithRanges(req, res, target, MIME[extname(target).toLowerCase()] ?? "application/octet-stream")
}

/**
 * Start the loopback media server.
 * @param getRoots - called per request so a late-resolving install is picked
 * up without a restart.
 * @param port - preferred port; 0 lets the OS pick one.
 * @returns the bound URL and a stopper.
 */
export function startMediaServer(
  getRoots: () => MediaRoots,
  port = 0,
): Promise<{ url: string; stop(): Promise<void> }> {
  const server: Server = createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*")
    res.setHeader("access-control-allow-methods", "GET, HEAD, OPTIONS")
    res.setHeader("access-control-allow-headers", "range")
    res.setHeader("access-control-expose-headers", "content-range, accept-ranges, content-length")
    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405)
      res.end()
      return
    }
    /* node:http always sets url on server requests */
    const rawPath = new URL(req.url ?? "/", "http://x").pathname
    let decoded: string
    try {
      decoded = decodeURIComponent(rawPath)
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    serveMedia(getRoots(), decoded, req, res)
  })
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise)
    server.listen(port, "127.0.0.1", () => {
      const address = server.address()
      const bound = typeof address === "object" && address !== null ? address.port : port
      resolvePromise({
        url: `http://127.0.0.1:${bound}`,
        stop: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

/**
 * Build one on-disk relative path's URL segments under the media base.
 * @param mediaBase - the loopback server root URL.
 * @param collection - which collection the wallpaper came from.
 * @param id - wallpaper id (directory name).
 * @param relativePath - path as project.json wrote it (either slash style).
 */
export function mediaUrl(
  mediaBase: string, collection: "workshop" | "bundled", id: string, relativePath: string,
): string {
  const segments = relativePath
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `${mediaBase}/wallpapers/${collection}/${encodeURIComponent(id)}/${segments}`
}

/** Re-export for roster builders. */
export type { WallpaperSummary }
