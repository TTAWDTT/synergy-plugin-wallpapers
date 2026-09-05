import * as solid from "solid-js"
import * as web from "solid-js/web"
import * as store from "solid-js/store"
import type { PluginSettingsComponentProps, PluginSurfaceContext } from "@ericsanchezok/synergy-plugin/ui"

Object.assign(globalThis, { __SYNERGY_PLUGIN_SOLID_RUNTIME__: { solid, web, store } })
const pluginUrl = "/plugin.js"
const plugin = await import(pluginUrl)
const manifest = await (await fetch("/manifest.json")).json()
const settingsEntry = manifest.contributions.find((entry: { kind: string }) => entry.kind === "ui.settings")
const footerEntry = manifest.contributions.find((entry: { kind: string }) => entry.kind === "ui.slot")
const Settings = plugin[settingsEntry.component.exportName] as solid.Component<PluginSettingsComponentProps>
let saved: Record<string, unknown> = JSON.parse(localStorage.getItem("wallpaper-smoke-settings") ?? "{}")
const [draft, setDraft] = solid.createSignal(saved)
const listeners = new Set<(values: Record<string, unknown>) => void>()
const roster = {
  wallpapers: [
    { id: "fixture", collection: "workshop", title: "Test wallpaper", kind: "web", supported: true, previewUrl: null, entryUrl: `${location.origin}/media/wallpaper.html`, properties: [], contentRating: null },
    { id: "video", collection: "workshop", title: "Test video", kind: "video", supported: true, previewUrl: null, entryUrl: `${location.origin}/media/sample.webm`, properties: [], contentRating: null },
  ],
  steamRootsFound: true, installFound: true,
}
const context: PluginSurfaceContext = {
  pluginId: "synergy-wallpapers", scopeId: "smoke", surface: { kind: "ui.settings", id: "wallpaper" },
  settings: {
    async get() { return saved },
    async replace(values) { saved = values; persist() },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  },
  operations: { async query<Output>() { return roster as Output }, async command<Output>() { return undefined as Output } },
  events: { subscribe() { return () => {} } },
  host: { notify(message) { document.querySelector("#notifications")!.textContent = message }, openSession() {}, openPluginPage() {}, openWorkbenchPanel() {}, openResource() {}, async confirm() { return true } },
}
let closeSettings: (() => void) | undefined
let closeFooter: (() => void) | undefined
function persist() {
  localStorage.setItem("wallpaper-smoke-settings", JSON.stringify(saved))
  document.querySelector("#saved")!.textContent = `Saved selection: ${saved.selection ?? "none"}`
  for (const listener of listeners) listener(saved)
}
function open() {
  if (closeSettings) return
  closeSettings = web.render(() => solid.createComponent(Settings, { context, get values() { return draft() }, onChange: setDraft }), document.querySelector("#settings")!)
}
if (footerEntry) closeFooter = web.render(() => solid.createComponent(plugin[footerEntry.component.exportName], { context: { ...context, surface: { kind: "ui.slot", id: "wallpaper-background" } } }), document.querySelector("#footer")!)
document.querySelector("#open")!.addEventListener("click", open)
document.querySelector("#save")!.addEventListener("click", () => { saved = draft(); persist() })
document.querySelector("#close")!.addEventListener("click", () => { closeSettings?.(); closeSettings = undefined })
document.querySelector("#discard")!.addEventListener("click", () => { setDraft(saved) })
document.querySelector("#disable")!.addEventListener("click", () => { closeSettings?.(); closeSettings = undefined; closeFooter?.(); closeFooter = undefined })
document.querySelector("#theme")!.addEventListener("click", () => { document.documentElement.dataset.colorScheme = document.documentElement.dataset.colorScheme === "dark" ? "light" : "dark" })
persist()
open()
