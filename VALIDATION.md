# Local validation — 2026-09-05

## 0.3.0 fusion extension

- Signed package SHA-256: `13737ec4832aa2cdd756438a035708aa18020b28b604570d9dd8f8cd55e0523f`.
- Generation: `eb20de44955d166386c13ff40d35453fd283e371424971adc18237af58c215c4`.
- Stable installed archive: `D:\Github\synergy-wallpaper-plugin\.local-install\20260905-141001\plugin\synergy-wallpapers-0.3.0.synergy-plugin.tgz`; matching signature alongside it. Pre-update plugin configuration was exported in the parent directory.
- Typecheck, build, runtime discovery/integrity validation, pack and signing passed. Unit tests: 47 passed, 100 assertions. `git diff --check` passed (existing CRLF warnings only).
- Isolated integration test used the compiled patched 3.0.22 runtime and its installed frontend on port 43200, with a separate preflight SYNERGY_HOME and no user credentials. Both native light and dark theme selections were visually inspected. Sidebar and toolbar shared 76% translucent tinted surfaces with 16px blur; composer was 88%, settings dialog 96%.
- The video thumbnail actually yielded `rgb(41, 84, 104)`, not the neutral fallback. Four range controls were exercised using the browser form-input API. Stored values 88 / 12 / 35 / 2 restored after save and page reload; the video decoded at 1920 pixels and continued playing. Presets and disabling tint applied immediately. Unit tests additionally verify appearance-only updates do not mount another media layer.
- Discard restored saved fusion values. Closing wallpaper removed its layer, active attribute and all six inline fusion properties; discarding that change restored playback. Keyboard ArrowRight selected and focused the appearance tab. Native pointer dragging and native-desktop visual inspection were not automated in this extension pass.
- Live port 4096 now reports plugin 0.3.0 loaded. All previously stored plugin settings compare unchanged after update; no user theme or selected wallpaper was overwritten, and no desktop restart was performed. A fresh browser view of the live backend confirmed active fusion, 16px sidebar blur, the currently selected 2560-pixel video playing, and thumbnail sampling. An already-open desktop may need a UI reload if it retains the old plugin module.
- Reduced-transparency / forced-colors CSS fallbacks are implemented but not OS-emulated in this pass. No exhaustive contrast certification across every wallpaper, custom theme, third-party UI or GPU performance benchmark is claimed.

## Earlier 0.2.0 media validation

- Plugin: `synergy-wallpapers-0.2.0.synergy-plugin.tgz` with matching Ed25519 signature.
- SHA-256: `e2b1bf58bd4b8c8d964fd7e181faebb4469d0c38691fce9dce9afcf6092858cf`.
- Generation: `f30ba22f2ee1a7ca53f7d9798c57af2a03e7aa949b62d1d98f879de548593674`.
- Host: working source at `D:\Github\synergy`, with the same-origin resource patch, serving installed 3.0.22 frontend assets.
- Isolated backend: port 43199, `SYNERGY_HOME=D:\Github\synergy-wallpaper-plugin\.debug-synergy`. No user sessions or provider credentials copied.

## Results

- Plugin typecheck, runtime discovery/integrity validation, build, pack and signing passed. Unit tests: 41 passed, 77 assertions.
- Host resource and real-Scope denial suites: 5 passed, 27 assertions. Host package typecheck and changed TypeScript lint passed; both repositories pass `git diff --check`.
- Real host browser: H.264 wallpaper decoded at 1920 pixels width, readyState 4, paused false; currentTime advanced from 0.793397 to 7.100459. Screenshot inspection confirmed visible wallpaper behind the main workbench, not just successful network requests.
- Save and close retained playback. Reload restored playback without opening settings. Closing wallpaper removed the layer; cancelling and confirming discard restored the saved video.
- Final picker: 36 of 36 displayed video thumbnails decoded; load-more expanded the gallery to 72 cards. Search by Workshop ID, video/web filtering and selected state were exercised. Settings dialog retained its opaque `rgb(15, 15, 16)` background.
- CORSAIR Collection failed its own framework initialization (`currentEffect.reset`). The final plugin surfaces the error, removes the iframe and disables transparency instead of leaving a white/blank wallpaper marked successful. It is not a compatible wallpaper in this build.
- Strict-CSP fixture: ordinary HTML wallpaper and generated WebM video rendered through the real proxy implementation. Disabling the plugin removed all layers and the active attribute.
- Real proxy range request returned HTTP 206, exactly 1024 bytes and `Content-Range: bytes 0-1023/36314739`; HEAD returned HTTP 200 with video/mp4.

## Checks not green

The repository-wide quality runner could not launch its `sh` commands from the Windows environment. Running its relevant checks individually passed `skill:check`; `decision:check` reported slash-normalization mismatches for existing archived records, and `doc:check` applied the 600-word fallback budget to existing package AGENTS paths. These unrelated checks were not patched. The earlier media validation did not build a complete desktop distributable; the subsequent installation replaced only the matching release runtime files.

## Installation state

Before this extension, the user authorized installation and restart of a patched 3.0.22 runtime plus plugin 0.2.0 and confirmed wallpaper display. That runtime was built from tag v3.0.22, not unrelated post-release development changes; backups are under `.local-install/20260905-1314`. The current extension updates only the plugin to 0.3.0 as recorded above. Temporary smoke servers 43197/43198 were stopped; isolated previews 43199/43200 were retained for development.
