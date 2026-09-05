import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { wallpaperDocument } from "../src/server/web-document.ts"

const project = resolve(import.meta.dir, "..")
const host = process.env.SYNERGY_SOURCE ?? "D:/Github/synergy"
const { proxyUIResource } = await import(pathToFileURL(resolve(host, "packages/synergy/src/plugin/ui-resource.ts")).href)
const media = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname
  if (path === "/wallpaper.html") return new Response(await wallpaperDocument(resolve(import.meta.dir, "fixtures/wallpaper.html"), resolve(import.meta.dir, "fixtures")), { headers: { "Content-Type": "text/html" } })
  if (path === "/sample.webm") return new Response(Bun.file(resolve(import.meta.dir, "fixtures/sample.webm")))
  return new Response("Not found", { status: 404 })
} })
const bundle = await Bun.build({ entrypoints: [resolve(import.meta.dir, "fixtures/browser-client.ts")], target: "browser", conditions: ["browser"] })
if (!bundle.success) throw new AggregateError(bundle.logs, "Smoke client build failed")
const client = await bundle.outputs[0]!.text()
const hostCss = (await Bun.file(resolve(host, "packages/app/src/index.css")).text()).replace(/^@import.*$/m, "")
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.WALLPAPER_TEST_PORT ?? 43197),
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.startsWith("/media/")) return proxyUIResource({ request, resourceBase: new URL("/media/", request.url).href, target: new URL(path.slice(7), media.url).href })
    if (path === "/client.js") return new Response(client, { headers: { "Content-Type": "text/javascript" } })
    if (path === "/host.css") return new Response(hostCss, { headers: { "Content-Type": "text/css" } })
    if (path === "/plugin.js") return new Response(Bun.file(resolve(project, "dist/ui/index.js")))
    if (path === "/plugin.css") return new Response(Bun.file(resolve(project, "dist/ui/index.css")))
    if (path === "/manifest.json") return new Response(Bun.file(resolve(project, "dist/plugin.json")))
    if (path !== "/") return new Response("Not found", { status: 404 })
    return new Response(`<!doctype html><html data-color-scheme="dark"><head><meta charset="utf-8"><title>Wallpaper lifecycle smoke test</title><link rel="stylesheet" href="/host.css"><link rel="stylesheet" href="/plugin.css"><style>
      :root{--background-stronger:#111;--background-base:#222;--surface-raised-base:#292929;--text-base:#eee;--text-strong:#fff;--surface-raised-stronger-non-alpha:#333}
      html,body,#root{margin:0;min-height:100vh;font:16px sans-serif}button{padding:8px;margin:4px}#toolbar{padding:16px;position:relative;z-index:2}#workbench{height:70vh;padding:20px}#panel{padding:24px;height:50vh}#settings{max-width:850px;padding:20px;background:#242424}#notifications{color:#ff8888}
    </style></head><body><div id="root"><div id="toolbar"><button id="open">Open settings</button><button id="save">Save settings</button><button id="close">Close settings</button><button id="discard">Discard settings</button><button id="disable">Disable plugin</button><button id="theme">Toggle theme</button><p id="saved"></p><div id="notifications" role="status"></div></div><div id="settings"></div><main id="workbench" class="synergy-workbench-canvas"><section id="panel" class="workbench-card-surface">Host workbench card</section></main><div id="footer"></div></div><script type="module" src="/client.js"></script></body></html>`, { headers: { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; connect-src 'self' ws: wss: blob: data:; frame-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" } })
  },
})
console.log(`Wallpaper smoke fixture: ${server.url}`)
