import { expect, test } from "bun:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runInNewContext } from "node:vm"
import { wallpaperDocument } from "../src/server/web-document.ts"

test("web wallpapers receive project defaults on load without executing property text", async () => {
  const root = await mkdtemp(join(tmpdir(), "wallpaper-document-"))
  try {
    await writeFile(join(root, "index.html"), '<html><head><meta charset="utf-8"></head><body>Fixture</body></html>')
    await writeFile(join(root, "project.json"), JSON.stringify({ general: { properties: { scene: { value: "circuit" }, text: { value: '</script><script>throw Error("injected")</script>' } } } }))
    const html = await wallpaperDocument(join(root, "index.html"), root)
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!
    let load: (() => void) | undefined
    let values: unknown
    const window = {
      parent: { postMessage() {} },
      addEventListener(event: string, listener: () => void) { if (event === "load") load = listener },
      wallpaperPropertyListener: { applyUserProperties(input: unknown) { values = input } },
    }
    runInNewContext(script, { window })
    expect(values).toBeUndefined()
    load!()
    expect(values).toEqual({ scene: { value: "circuit" }, text: { value: '</script><script>throw Error("injected")</script>' } })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.each(["throw", "framework"])("web initialization errors are reported instead of claiming readiness: %s", async (mode) => {
  const root = await mkdtemp(join(tmpdir(), "wallpaper-document-"))
  try {
    await writeFile(join(root, "index.html"), "<html><head></head></html>")
    const html = await wallpaperDocument(join(root, "index.html"), root)
    const callbacks = new Map<string, (event?: unknown) => void>()
    const messages: unknown[] = []
    const window = {
      console: { error(_error: unknown) {} },
      parent: { postMessage(message: unknown) { messages.push(message) } },
      addEventListener(name: string, callback: (event?: unknown) => void) { callbacks.set(name, callback) },
      wallpaperPropertyListener: { applyUserProperties() {
        const error = new Error("Unsupported native API")
        if (mode === "throw") throw error
        window.console.error(error)
      } },
    }
    runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1]!, { window })
    callbacks.get("load")!()
    expect(messages).toEqual([{ source: "synergy-wallpapers", state: "error", message: "Unsupported native API" }])
  } finally { await rm(root, { recursive: true, force: true }) }
})
