/**
 * Regression tests for the traversal guard: ids and suffix segments carrying
 * path semantics must answer 403 before any resolution, and the resolved
 * target must stay anchored at the collection root. Ported from the dsh
 * wallpapers plugin's hardening suite.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serveMedia, type MediaRoots } from "../src/server/media-server.ts"

function makeRequest(url: string, method = "GET"): Request {
  return new Request(`http://127.0.0.1${url}`, { method })
}

/** Minimal node:http-shaped request/response over fetch primitives. */
class FakeResponse {
  status = 200
  headers = new Map<string, string>()
  body: Uint8Array | null = null
}

// serveMedia writes through node:http ServerResponse; tests use a tiny stub
// implementing the surface the guard touches (writeHead/end + header set).
function makeRes(): { res: import("node:http").ServerResponse; captured: FakeResponse } {
  const captured = new FakeResponse()
  let sent = false
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      sent = true
      captured.status = status
      for (const [key, value] of Object.entries(headers ?? {})) captured.headers.set(key, String(value))
      return res as unknown as import("node:http").ServerResponse
    },
    end(body?: Uint8Array | string) {
      if (typeof body === "string") captured.body = new TextEncoder().encode(body)
      else if (body instanceof Uint8Array) captured.body = body
      return res as unknown as import("node:http").ServerResponse
    },
    setHeader(name: string, value: string) {
      captured.headers.set(name, String(value))
      return res as unknown as import("node:http").ServerResponse
    },
    destroy() {},
    on() {},
    once() {},
    emit() {},
    // Collect the createReadStream body so the legitimate-file assertion can
    // read it; stream.pipe(res) feeds `data` events.
    write(chunk?: Uint8Array | string) {
      if (typeof chunk === "string") {
        captured.body = (captured.body ?? new Uint8Array())
        const merged = new Uint8Array(captured.body.length + chunk.length)
        merged.set(captured.body, 0)
        merged.set(new TextEncoder().encode(chunk), captured.body.length)
        captured.body = merged
      } else if (chunk instanceof Uint8Array) {
        const previous = captured.body ?? new Uint8Array()
        const merged = new Uint8Array(previous.length + chunk.length)
        merged.set(previous, 0)
        merged.set(chunk, previous.length)
        captured.body = merged
      }
      return true
    },
    pipe(source: { on(event: string, fn: (chunk: Uint8Array) => void): unknown }) {
      source.on("data", (chunk) => {
        const previous = captured.body ?? new Uint8Array()
        const merged = new Uint8Array(previous.length + chunk.length)
        merged.set(previous, 0)
        merged.set(chunk, previous.length)
        captured.body = merged
      })
      return res as unknown as import("node:http").ServerResponse
    },
  } as unknown as import("node:http").ServerResponse
  Object.defineProperty(res, "headersSent", { get: () => sent })
  Object.defineProperty(res, "statusCode", { value: 200, writable: true })
  Object.defineProperty(res, "writableEnded", { get: () => false })
  return { res, captured }
}

let root: string
let roots: MediaRoots

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synergy-wallpapers-test-"))
  mkdirSync(join(root, "431960"), { recursive: true })
  writeFileSync(join(root, "431960", "index.html"), "<html>ok</html>")
  roots = { workshop: root }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Run one request through the guard; returns the captured response. The
 * file-stream path answers asynchronously, so the capture is awaited. */
async function serve(url: string): Promise<FakeResponse> {
  const { res, captured } = makeRes()
  const req = {
    method: "GET",
    headers: {} as Record<string, string>,
    url: url,
  } as unknown as import("node:http").IncomingMessage
  serveMedia(roots, decodeURIComponent(url.split("?")[0]!), req, res)
  await new Promise((done) => setTimeout(done, 10))
  return captured
}

describe("traversal guard", () => {
  test("rejects dot-dot ids with 403", async () => {
    expect((await serve("/wallpapers/workshop/../secret.txt")).status).toBe(403)
  })

  test("rejects percent-encoded dot-dot ids with 403", async () => {
    expect((await serve("/wallpapers/workshop/%2e%2e/secret.txt")).status).toBe(403)
  })

  test("rejects backslash ids with 403", async () => {
    expect((await serve("/wallpapers/workshop/..%5Csecret.txt")).status).toBe(403)
  })

  test("rejects ids with embedded separators", async () => {
    // `sub/dir` splits into segments [sub, dir]; the guard reads only the
    // id segment, but the resolved target must stay inside the root —
    // `sub` does not exist here, so serving answers 404 (never 200).
    const response = await serve("/wallpapers/workshop/sub/dir")
    expect([403, 404]).toContain(response.status)
  })

  test("rejects drive-absolute ids", async () => {
    expect((await serve("/wallpapers/workshop/C:\\Windows\\win.ini")).status).toBe(403)
  })

  test("rejects dot ids", async () => {
    expect((await serve("/wallpapers/workshop/.")).status).toBe(403)
  })

  test("serves a legitimate file", async () => {
    const response = await serve("/wallpapers/workshop/431960/index.html")
    expect(response.status).toBe(200)
    expect(new TextDecoder().decode(response.body ?? new Uint8Array())).toContain("ok")
  })

  test("404s unknown collections and ids", async () => {
    expect((await serve("/wallpapers/bogus/431960/index.html")).status).toBe(404)
    expect((await serve("/wallpapers/workshop/999999/index.html")).status).toBe(404)
  })

  test("404s when the collection root has not resolved", async () => {
    roots = {}
    expect((await serve("/wallpapers/workshop/431960/index.html")).status).toBe(404)
  })
})
