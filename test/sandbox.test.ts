/**
 * Regression tests for the web-wallpaper iframe sandbox: the frame must be
 * sandboxed to scripts only (opaque origin) — `allow-same-origin` would hand
 * same-origin user HTML its full origin privileges back. Ported from the dsh
 * wallpapers plugin's hardening suite, with jsdom standing in for the DOM.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mountWallpaperLayer, WEB_LOAD_TIMEOUT_MS } from "../src/ui/wallpaper-layer.ts"
import type { WallpaperSummary } from "../src/server/types.ts"

// jsdom via bun's built-in DOM? bun:test has no DOM; use happy-dom-free stub:
// mountWallpaperLayer only touches document.createElement/body.appendChild,
// so a minimal global document stub is exact for what the unit asserts.
interface RecordedElement {
  tag: string
  attributes: Map<string, string>
  style: Record<string, string>
  children: RecordedElement[]
  dataset: Record<string, string>
  appended: boolean
  removed: boolean
  listeners: Map<string, Array<() => void>>
}

function makeDocument(): { document: Record<string, unknown>; layers: RecordedElement[] } {
  const layers: RecordedElement[] = []
  const createElement = (tag: string): RecordedElement => {
    const element: RecordedElement = {
      tag,
      attributes: new Map(),
      style: {},
      children: [],
      listeners: new Map(),
      appended: false,
      removed: false,
      dataset: {},
      setAttribute(name: string, value: string) {
        element.attributes.set(name, value)
      },
      getAttribute(name: string) {
        return element.attributes.get(name) ?? null
      },
      appendChild(child: RecordedElement) {
        element.children.push(child)
      },
      addEventListener(event: string, fn: () => void) {
        const list = element.listeners.get(event) ?? []
        list.push(fn)
        element.listeners.set(event, list)
      },
      remove() {
        element.removed = true
      },
    }
    return element
  }
  const fakeDocument = {
    createElement,
    body: {
      appendChild(node: RecordedElement) {
        node.appended = true
        layers.push(node)
      },
    },
    documentElement: { style: { setProperty() {}, removeProperty() {} }, getAttribute: () => "dark" },
  }
  return { document: fakeDocument, layers }
}

function summary(kind: WallpaperSummary["kind"], entryUrl: string | null): WallpaperSummary {
  return {
    id: "1234",
    collection: "workshop",
    title: "Test",
    kind,
    supported: kind === "video" || kind === "web",
    previewUrl: null,
    entryUrl,
    properties: [],
    contentRating: null,
  }
}

describe("web wallpaper iframe sandbox", () => {
  // mountWallpaperLayer checks `media instanceof HTMLVideoElement` to decide
  // whether to autoplay, so the element constructors must exist as globals
  // for every test that mounts a layer.
  beforeEach(() => {
    ;(globalThis as { HTMLVideoElement?: unknown }).HTMLVideoElement = function FakeVideoElement(this: unknown) {
      return this
    }
    ;(globalThis as { HTMLIFrameElement?: unknown }).HTMLIFrameElement = function FakeIFrameElement(this: unknown) {
      return this
    }
  })

  afterEach(() => {
    delete (globalThis as { HTMLVideoElement?: unknown }).HTMLVideoElement
    delete (globalThis as { HTMLIFrameElement?: unknown }).HTMLIFrameElement
    delete (globalThis as { document?: unknown }).document
  })

  test("web frames carry sandbox=allow-scripts and nothing else", () => {
    const { document, layers } = makeDocument()
    ;(globalThis as { document?: unknown }).document = document
    const dispose = mountWallpaperLayer(summary("web", "http://127.0.0.1:1/wallpapers/workshop/1/index.html"), true)
    expect(layers).toHaveLength(1)
    const frame = layers[0]!.children[0]!
    expect(frame.tag).toBe("iframe")
    expect(frame.attributes.get("sandbox")).toBe("allow-scripts")
    expect(frame.attributes.get("sandbox")?.includes("allow-same-origin")).toBe(false)
    expect(frame.style.pointerEvents).toBe("none")
    dispose()
  })

  test("video layers mount a muted looping video", () => {
    const { document, layers } = makeDocument()
    ;(globalThis as { document?: unknown }).document = document
    const dispose = mountWallpaperLayer(summary("video", "http://127.0.0.1:1/wallpapers/workshop/1/v.mp4"), false)
    const video = layers[0]!.children[0]!
    expect(video.tag).toBe("video")
    // Property assignments land on the element record; assert the ones the
    // background stage relies on.
    expect((video as unknown as Record<string, unknown>).loop).toBe(true)
    expect((video as unknown as Record<string, unknown>).autoplay).toBe(true)
    expect((video as unknown as Record<string, unknown>).playsInline).toBe(true)
    dispose()
  })

  test("scene/unknown kinds mount nothing", () => {
    const { document, layers } = makeDocument()
    ;(globalThis as { document?: unknown }).document = document
    const dispose = mountWallpaperLayer(summary("scene", null), true)
    expect(layers).toHaveLength(0)
    dispose()
    delete (globalThis as { document?: unknown }).document
  })

  test("the load watchdog timeout stays 15 seconds", () => {
    expect(WEB_LOAD_TIMEOUT_MS).toBe(15_000)
  })
})
