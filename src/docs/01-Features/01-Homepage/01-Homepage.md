# Active Theory (activetheory.net) — Reverse-Engineered Build Spec

A study of `https://activetheory.net` (v6 site, observed 2026-05-10). This document is written as an **instruction set for AI/coding agents**: each section is self-contained, names the technology choices, specifies the visual/interaction behavior, and includes the asset/data shapes seen on the live site. Use this as a feature menu — pick the section that matches what you want to build, hand the relevant block to an agent, and it has enough context to act.

---

## 0. TL;DR — What this site actually is

Active Theory's homepage is **a single full-screen WebGL2 canvas** that renders the *entire* visual experience — text, navigation, project tiles, transitions, particles, post-processing — inside one `<canvas>`. The DOM is a thin shell (about 4 root divs) used only for:
- accessibility/SEO links (rendered off-screen)
- a chat-style "Ask me anything…" input
- HTML5 `<video>` elements that are uploaded to GPU as **video textures**
- a cookie banner
- a fullscreen video modal for opening case studies

Scrolling does **not** scroll the page. `document.scrollHeight === window.innerHeight` always. Wheel / touch / arrow input is captured and fed into a virtual scroll progress (0…1) that drives a **horizontal world-traversal**: a "marble" (the chrome `a` logo wrapped in a glass ring) glides along an infinity-shaped ribbon through a procedural particle landscape; each project becomes a *biome* you pass through.

Top-right is a fixed **navigation pill**: `WORK ─ ⌒ ─ CONTACT` with a sine-wave divider and a smaller pill below showing `<<  N. PROJECT_NAME  >>` for direct project paging.

All copy, all UI chrome, all icons are **drawn by GPU shaders + GLUI** (their custom WebGL UI layer), with parallel DOM duplicates marked `aria-label` for screen readers / Google.

---

## 1. Tech Stack (verified by introspection of `window` globals)

| Layer | What they use | Notes |
|---|---|---|
| Renderer | **Hydra** (Active Theory's in-house WebGL2 framework) | exposed globally as `Hydra`, `Render`, `Renderer`, `FBORendererWebGL`, `GeometryRendererWebGL`, `ShaderRendererWebGL`, `TextureRendererWebGL` |
| Public OSS sibling | **alien.js** (github.com/alienkity/alien.js) | the dev-friendly extraction of Hydra; safe to use as a stand-in |
| Tweening | Custom: `FrameTween`, `TweenManager`, `MathTween`, `TweenTimeline` | RAF-driven, no GSAP |
| Text in WebGL | `GLText`, `GLTextGeometry`, `GLTextThread` (MSDF / SDF text) | uses **BMFont JSON** atlases (`NBArchitektStd-*.json` + PNG) |
| UI in WebGL | `GLUI`, `GLUIElement`, `GLUIBatch`, `GLUIBatchText`, `GLUIStageInteraction2D/3D` | batched draw calls for buttons, pills, scrollers |
| Accessibility | `GLA11y`, `GLSEO` | mirrors every visual link/heading into hidden DOM with `aria-label` |
| Workers | `hydra-thread.js` loaded ~6× | one OffscreenCanvas worker per heavy subsystem (text layout, geometry, FBO postFX, etc.) |
| Geometry | `GLTFLoader` + **Draco** (`draco_decoder.wasm`, `draco_wasm_wrapper.js`) | compressed mesh decode in worker |
| Textures | **Basis Universal** (`basis_transcoder.wasm` + `.js`) | GPU-friendly `.ktx2` transcoded client-side |
| Spatial audio | `GlobalAudio3D` with material presets (`ACOUSTIC_CEILING_TILES`, `BRICK_BARE`, `CONCRETE_BLOCK_*`, `CURTAIN_HEAVY`, `FIBER_GLASS_INSULATION`, `GLASS_THICK`, …) | Resonance-style room acoustics |
| Scroll mgr | `ScrollRenderManager` | reads wheel/touch and drives global scroll progress |
| Render perf | `RenderCount`, `RenderMonitor`, `RenderStats`, `RenderTimer`, `RenderTimeQuery` | GPU EXT_disjoint_timer_query for per-pass ms tracking |
| QR | `qrious.js` | for "scan to view on phone" / share links |
| Analytics | `gtag` (`G-J7TMDT4F8N`) only — no tag manager bloat | |
| CMS | static JSON on Google Cloud Storage (`storage.googleapis.com/activetheory-v6.appspot.com/cms/{metadata,contact,projects}-dev.json?v=…`) | versioned via cache-buster in URL |
| Geo | `us-central1-at-services.cloudfunctions.net/geo` | for region-based defaults |
| Build | single bundle `app.<13-digit-timestamp>.js` + lazy `modules.<ts>.js` | timestamp = build version |
| **Three.js?** | **No.** `window.THREE` is undefined. | |

> **Agent rule of thumb:** when asked to "build like Active Theory", default to **alien.js + ogl** (or the OP repo's `oimo`/`gl-matrix` foundations). Do **not** pick Three.js unless the user explicitly says to — Active Theory's whole identity is custom shaders and a minimal abstraction over WebGL2.

---

## 2. DOM Skeleton

```
<body>
  <noscript>…</noscript>
  <div id="Stage">
    <div class="GLA11y">
      <div class="NavigationUI">
        <a class="link" href="#" aria-label="Toggle Audio">Toggle Audio</a>
        <a class="link" href="#" aria-label="Work">Work</a>
        <a class="link" href="#" aria-label="Contact">Contact</a>
      </div>
    </div>
    <div class="Container">…full-screen canvas + GLUI…</div>
    <div class="ChatDOM">
      <div class="wrapper">
        <div class="messages">
          <a class="home">-> games</a>
          <a class="home">-> multiplayer</a>
          <a class="home">-> XR / VR / AI</a>
          <a class="home">-> installations</a>
          <a class="home">-> websites</a>
        </div>
        <p>What are you looking for?</p>
        <textarea class="input" placeholder="Ask me anything..."></textarea>
        <div class="flashing"></div>  <!-- caret blink -->
      </div>
    </div>
    <div class="FXScroll">
      <div class="scrollElement"></div>  <!-- ×6 spacers to give wheel events a target -->
    </div>
    <div class="CookieBanner">…</div>
    <div class="VideoTextures">
      <video></video>  <!-- streamed and uploaded to GPU as a texture -->
    </div>
    <div class="VideoModal">
      <div class="closeButton"><a href="#" class="hit">Close Video</a></div>
      <video></video>  <!-- regular DOM video for case-study playback -->
    </div>
  </div>
</body>
```

**Build rules:**
1. The `<canvas>` is sized to `devicePixelRatio × innerWidth × innerHeight` (saw 3020×1994 backing store at 1510×997 CSS, dpr 2) and given `pointer-events: none; background: black;` — input is captured by a transparent sibling, not the canvas.
2. Always pair every visual interactive with a hidden DOM `<a>` carrying the matching `aria-label`. Without this, Google sees nothing.
3. `noscript` content is ~164 chars — a one-line "JavaScript is required" message. No JSON-LD.

---

## 3. Boot Sequence (Knock-to-Enter)

This is the part most agents get wrong. **Don't skip the loader — it is part of the brand.**

| Phase | Visual | Mechanic |
|---|---|---|
| 0–1.5s | Plain black screen, tiny `/12` counter centered | counts assets queued (12 critical) |
| 1.5–10s | Counter animates up (`/12`, `/55`, `/100`, …) and morphs into a **typographic ASCII sphere** built from the characters `/`, `5`, `7`, dot — drawn with the brand mono font as glyph atoms forming a 3D rotating orb | This is **GLText writing characters onto a sphere geometry** while loading; the loader is also the brand intro. |
| 10–14s | Sphere "blooms" — 8 cyan tendrils erupt outward, then snap into petals, then collapse | First WebGL post-pass kicks in: bloom + chromatic aberration + curl-noise displacement |
| 14s | User must **click the orb** to enter (the orb reacts to cursor proximity with vector-field distortion before click) | `requestAudioContext()` happens here so spatial audio can start; gating behind a click is what enables Web Audio in Chrome/Safari |
| Post-click | Cut to home: black void + the Active Theory `a` logo trapped inside a clear glass ring with a stretched figure-8 / vesica ribbon trailing below it. Particles drift past. Top-right pill fades in with `WORK ─ CONTACT`. Centered text `SCROLL DOWN` appears | Transition is a 1-second `MathTween` on camera-Z + alpha, not a router push |

**Asset budget seen during boot:**
- `/assets/data/uil.<ts>.json` — UI layout / shader uniform bindings (UIL = "UI Library")
- `/assets/shaders/compiled.vs` — **single concatenated text file with ~120+ shaders separated by `{@}` delimiters** (utilities, blends, FXAA, blur, volumetric light, curl noise, PBR, glass, mirror, water, radial blur, RGB shift, shadows, skinning, instancing, VR controllers)
- `/cms/metadata-dev.json`, `/cms/contact-dev.json`, `/cms/projects-dev.json` (GCS, versioned)
- BMFont atlases: `NBArchitektStd-Regular.json`, `…-Light.json`, `…-Bold.json` (+ matching PNGs)
- `draco_decoder.wasm`, `basis_transcoder.wasm`
- `qrious.js` (≈11kB)
- WOFF2 of NBArchitektStd in 3 weights for the DOM fallback

---

## 4. Typography & Color

- **Display + body:** `nbarchitekt` (NB Architekt Std) — Light 300, Regular 400, Bold 700. All caps in display. Slightly condensed monospace-feel. Ship as WOFF2 + WOFF + OTF.
- **In-canvas text:** baked to MSDF/SDF atlas via the same family (the `.json` BMFont files).
- **Background:** pure `#000000` (`theme-color` meta + `<canvas style="background:black">`).
- **Brand accents (sampled from screenshots):**
  - Loader cyan: `#7FE3FF`-ish
  - Home logo iridescent: rainbow sweep R/G/B/cyan (chromatic aberration on a glass shader)
  - Project biome 1 ("dusk"): magenta/orange particles `#E5337A` → `#FFAA33`
  - Project biome 2 ("xbox"): teal/lime + violet `#1FE5C0` / `#7E40FF`
  - UI line color: `#A8B5C8` ~70% alpha
- **Particle color from CMS:** projects expose `uiColor` (hex) — used to tint the particle field in their biome.
- **Cursor:** OS cursor is kept; a custom GL "ring" is drawn around the world-marble, not around the actual mouse pointer. There is **no DOM custom cursor**.

---

## 5. Layout: The Top-Right Navigation Pill

A single rounded-rect "pill" sits flush at top-right (~24px inset). Two stacked rows:

**Row 1 — Global nav (always visible):**
```
┌───────────────────────────────────────┐
│  WORK    ╮︵╰   CONTACT                │
└───────────────────────────────────────┘
```
- Two text labels separated by an animated **sine-wave divider** that ripples constantly at ~0.5Hz amplitude 4px.
- Hovering either label triggers a `tween` brightening the underlying glass and emits a soft white halo.
- On Contact open, "CONTACT" swaps to "CLOSE-X".

**Row 2 — Project pager (appears after first scroll input):**
```
┌──────────────────────────────────────┐
│  <<     6. NUER SELF — DUSK     >>   │
└──────────────────────────────────────┘
```
- `<<` and `>>` step ±1 project with a 600ms biome cross-fade.
- Center text marquees if longer than the pill width.
- A play-button icon may appear at the right edge when the current project has a fullscreen video.

**Pill chrome:** thin 1px outline, faint inner highlight, drop shadow with subtle screen-blend bloom — drawn by the GLUI shader, not CSS.

---

## 6. The Home Scene — "Glass Marble on a Ribbon"

Visible immediately after the boot click.

**Stack of 3D elements:**
1. `Element_3_home` — geometry of the ribbon (an infinity / lemniscate path extruded into a thin tube, glass material with refraction + dispersion).
2. The **logo orb** — the lowercase `a` extruded as a thick glyph, wrapped in a torus ring, rendered with a chromatic-glass shader (high IOR, RGB index-of-refraction split, Fresnel rim).
3. `CleanRoom` floor — `FloorShader` — a soft circular ground reflection the marble glides over.
4. Particle systems — 4 named particle fields in `uil.json` driven by **curl noise** + **fluid dynamics** behavior code blocks.
5. Post-pipeline — bloom → radial blur → RGB shift → FXAA.

**Behavior:**
- Cursor proximity to the orb runs a vertex-shader displacement (`uMouse`, `uMouseStrength`) that distorts the ring outward.
- On scroll input, the orb decouples from the home anchor and starts traveling along the ribbon path; behind it, the ribbon stretches and warps.
- Particles "blow past" the marble (direction reversed when scrolling up) — they are in world space, not screen space.
- A faint comet/sparkle trail flies *past* the marble each scroll tick to amplify motion (`-1 to +1` velocity-based emission).

> **For an agent recreating this:** the path is parameterized as a Catmull-Rom curve sampled by scroll progress (0…1). Each project is a `t` anchor on the curve; transitions are camera dollies along the same curve.

---

## 7. Project Browser — Biome Transitions

There is **no project grid page**. Browsing IS scrolling.

- Each project = one biome ≈ 12% of total scroll. ~8–12 biomes per traversal.
- Crossing a biome boundary triggers:
  1. Particle color & turbulence params morph to next project's `uiColor`.
  2. Background environment cube swaps via 1s cross-fade.
  3. Spatial-audio bus changes its "room material" (the BRICK/GLASS/etc. presets) so the ambient track gets a new reverb.
  4. The pager row in the top-right pill tweens from `N. CURRENT` to `N+1. NEXT`.
  5. A floating refractive **project tile** drifts past the marble — see §8.

**The figure-8 ribbon doubles as a progress indicator** — the marble sits at the crossover; the bottom loop fills/drains with the project's color as you near its tile.

---

## 8. Project Tiles ("Glass Slabs in Mid-Air")

Observed during the Contact / Work overlay states.

- Rounded-corner rectangular slab (~16:9) floating in 3D, slightly skewed off-axis.
- Material: **frosted dispersive glass** — a video texture lives behind a noise-bumped, IOR-1.45 surface so the artwork looks smeared, with chromatic edges, until the slab rotates square to camera.
- When square-on, the slab "clears" (roughness → 0) and you can read the project name + client logo (e.g. `XBOX — 20 YEARS OF XBOX`, `WSJ`, `Skybear`).
- Click → opens the **VideoModal** (DOM `<video>` overlay with close button) playing the case-study reel.
- Hover → mild parallax tilt + audio cue.

**Data source per tile** (from `cms/projects-dev.json`):
```json
{
  "id": "<mongo-id>",
  "name": "20 Years of Xbox",
  "slug": "xbox-20",
  "description": "…1–3 sentences…",
  "clientName": "Microsoft",
  "completionDate": "2021-11-15T00:00:00Z",
  "tags": ["Website", "Game"],
  "priority": 7,
  "uiColor": "#1FE5C0",
  "projectLogo": { "1x": "...", "2x": "...", "svg": "..." },
  "video": { "src": "...mp4", "poster": "...jpg" },
  "projectURL": "https://xbox20.xbox.com",
  "caseStudyURL": "https://medium.com/active-theory/..."
}
```

**Tile layout rules:**
- Up to 3 tiles visible simultaneously, staggered along Z (foreground hero + 2 peripheral).
- Foreground tile is interactive; peripherals are decorative + clickable to swap them forward.
- Particle density spikes around the active tile.

---

## 9. The "ChatDOM" — Conversational Discovery

Hidden by default; revealed after the user enters the Work overlay (URL changes to `/work`).

**Visible structure:**
```
WHAT ARE YOU LOOKING FOR?
-> WEBSITES
-> INSTALLATIONS
-> XR / VR / AI
-> MULTIPLAYER
-> GAMES
[ ASK ME ANYTHING... ]   ← rounded button reveals textarea on click
```

**Behavior:**
- Each `->` link filters the project carousel to that tag (matches `tags[]` in the CMS).
- The textarea (`placeholder="Ask me anything..."`) is real but in 2026 still appears wired to a basic keyword filter, not an LLM. Treat the AI hookup as optional — the categorical links are the primary path.
- Caret is a custom blinking `.flashing` div, not the browser caret.
- Copy color is the brand purple/pink seen on the magenta biome.

**Agent implementation note:** if asked to "add an AI assistant" for project discovery, wire the textarea to a small embedding-search over `projects.json` (name + description + client + tags), return top-3, and have the camera dolly to the matched biome.

---

## 10. The "Contact" Overlay

Triggered by clicking CONTACT in the top-right pill (URL toggle to `/`-with-state, not `/contact`).

**Visible structure:**
- Headline (left): `CREATIVE / DIGITAL / EXPERIENCES` set in NB Architekt Bold all-caps, three lines, scaled to ~12vw, white. A chrome-glass slab passes through the headline and refracts the letters in real time (the letters render twice: once as in-canvas SDF text, once distorted via the slab's normal map).
- Body (right):
  ```
  FOUNDED IN 2012
  WE BLEND STORY, ART & TECHNOLOGY AS AN
  IN-HOUSE TEAM OF PASSIONATE MAKERS

  OUR INDUSTRY-LEADING WEB TOOLSET
  CONSISTENTLY DELIVERS AWARD-WINNING
  WORK THROUGH QUALITY & PERFORMANCE
  ```
- Top-right pill swaps to `WORK — CLOSE-X`.
- A second scroll continues *through* contact into the Work biomes (it is a single scrollable world, not separate pages).

**No traditional contact form is exposed.** Inquiries go via the CMS-driven contact JSON (likely an email + booking link, fetched from `cms/contact-dev.json`).

---

## 11. Cookies & Privacy

Bottom-of-page banner (DOM, not WebGL):
- Two buttons: **Accept Cookies** (`button.accept`) and **Reject Cookies** (`button.reject`).
- Link: "Privacy Notice." → `https://activetheory.notion.site/privacy` (Notion-hosted policy).
- Banner only blocks GA, never blocks the experience itself.

---

## 12. Audio

- Boot click is the audio gate — Web Audio context resumed on user gesture.
- A "Toggle Audio" link is in `GLA11y` for keyboard users; visually it's an icon glyph in the top-left HUD.
- Each biome has its own loop; transitions cross-fade.
- `GlobalAudio3D` applies a room impulse response keyed to the current biome's surface material (the constants list `ACOUSTIC_CEILING_TILES`, `BRICK_*`, `CONCRETE_*`, `CURTAIN_HEAVY`, `FIBER_GLASS_INSULATION`, `GLASS_THICK`, …) — this is Resonance Audio's preset list, not a fanciful invention.

---

## 13. Performance Strategy

| Trick | What it buys |
|---|---|
| **6× Web Workers** loading `hydra-thread.js` | text layout, geometry decode, FBO compositing, particle stepping all off main thread |
| **Single `compiled.vs` shader bundle** | one network round trip for ~120 shaders; split client-side on `{@}` |
| **Basis Universal KTX2** textures | GPU-resident compressed textures, ~6× smaller than PNG/JPG, faster upload |
| **Draco-compressed glTF** | meshes ~10× smaller |
| **MSDF text** | crisp text at any zoom with one tiny atlas, batched into one draw call (`GLUIBatchText`) |
| **Single canvas, single context** | every UI element shares state — no DOM reflow, no compositor thrash |
| **GPU timer queries** (`RenderTimeQuery`) | live perf budgets per pass; renderer downscales the backbuffer if a pass exceeds budget |
| **dpr capped + dynamic** | `devicePixelRatio` honored but the renderer can drop to 1.0 on weak GPUs |
| **`will-read-frequently: false`** on canvas | hint the browser to keep the surface GPU-only |
| **Preload of `app.js` + `modules.js`** via `<link rel="preload">` in head | parallelizes critical path |
| **Build cache-buster = unix timestamp** in filename | infinite immutable cache, zero-config CDN |

---

## 14. Accessibility & SEO

- Every clickable WebGL element has a hidden `<a class="link" href="#" aria-label="…">` mirror in `<div class="GLA11y"><div class="NavigationUI">…`.
- Page title and OG tags are set normally:
  - `<title>Active Theory · Creative Digital Experiences</title>`
  - `og:image` → `storage.googleapis.com/.../media/social.jpg`
  - `og:type=website`, `twitter:card=summary_large_image`
- No JSON-LD / schema.org markup — they rely on the meta tags only.
- Apple PWA tags are set: `apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-status-bar-style=black`, custom `apple-touch-icon`, `manifest.json`, `safari-pinned-tab.svg`, `msapplication-TileColor=#ffffff`, `theme-color=#000000`.

---

## 15. Routes

The whole site uses real history navigation but **no actual page reloads**:
- `/` — home / boot
- `/work` — work overlay revealed (chat panel + tiles); the WebGL world doesn't restart
- `/<project-slug>` — observed in some click flows when opening a case study
- The boot loader is shown **only on cold load**; client-side route changes never re-trigger it.

---

## 16. Mobile

Viewport meta:
```
width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, minimal-ui, viewport-fit=cover
```
- Pinch-zoom disabled on purpose — protects the WebGL pixel ratio.
- Touch input replaces mouse; the orb tracks the average finger position.
- The figure-8 ribbon collapses to a vertical S-curve.
- Top-right pill becomes a single pill (`☰`) that expands to reveal the same options.
- Some heavy postFX (radial blur, dispersion split) drop on `deviceMemory < 4` or `hardwareConcurrency < 4` — measured live, not user-agent sniffed.

---

## 17. The Cookbook — How to Ask for Specific Features

When you (the user) want to add or replicate a feature on a project, hand the agent the matching block:

### A. "Add an Active-Theory-style boot loader"
> Build a full-screen black canvas loader. Phase 1: small mono `/N` counter where N counts assets requested by the page. Phase 2: typographic SDF sphere — sample a sphere mesh and place glyphs `/`, `5`, `7` at each vertex, slowly rotating, characters fading in as their corresponding asset finishes. Phase 3: 1s "bloom" — eight tendrils erupt outward via curl-noise vertex displacement, then collapse into a glass orb. Phase 4: orb idles, reacts to cursor proximity with a normalized `uMouse` shader uniform. Click the orb to dismiss the loader, resume the audio context, and tween the camera into the home scene over 1s. Use **alien.js** + **ogl** if no framework is given. Provide a fallback `<noscript>` line.

### B. "Add a horizontal scroll-driven biome browser"
> One canvas, one WebGL2 context. Capture wheel + touchmove + arrow keys; never scroll the document. Build a Catmull-Rom curve through N "biome anchors" (one per content item). Each anchor has: `uiColor`, `videoTexture`, particle params, and a "room material" preset from a fixed list. The camera dollies along the curve as scroll progress changes; biome params blend linearly between adjacent anchors. Render order: skybox → particles (instanced billboard with curl-noise) → glass tiles (refraction shader, IOR≈1.45, dispersion 0.02) → SDF text via batched draw → post (bloom + chromatic aberration + FXAA). Top-right pill shows `<<  N. CURRENT_NAME  >>` and steps with arrow buttons.

### C. "Add the chrome-glass logo orb"
> A torus ring around an extruded glyph (the brand mark). Material: PBR glass with three-channel IOR (RGB sampled at 1.45 / 1.46 / 1.47 for dispersion), Fresnel rim (power=5), env-map reflection, and a soft inner emissive. Vertex shader displaces by `uMouseStrength * curlNoise(position + uTime)` when a mouse uniform is near. Render with `BLEND_PREMULTIPLIED` and a separate post-pass for additive bloom.

### D. "Add the figure-8 ribbon with a marble"
> Sample a lemniscate parametric curve (`x = a*cos(t)/(1+sin²t)`, `y = a*sin(t)*cos(t)/(1+sin²t)`). Extrude into a tube of radius 0.02. Material: glass with the same dispersion as the orb but doubled rim intensity, and a fill that responds to a `uProgress` uniform — the bottom loop fills with the active biome's `uiColor` from `0` to `progress`. Marble = a sphere child of the orb, glued to the curve at `t = scrollProgress * 2π`.

### E. "Add the top-right navigation pill"
> Single rounded-rectangle SDF drawn in WebGL with a 1px outline (`#A8B5C8` @ 70%) and a faint inner highlight. Two text slots separated by a sine-wave divider rendered as a 1D function (`y = 4 * sin(x*0.2 + uTime)`). On hover, brighten the underlying glass + emit a soft halo. Below it, a second pill with `<<` `>>` arrows and a center label that marquees if too long. Both pills are batched into one `GLUIBatch` draw call.

### F. "Add the chat-style discovery panel"
> Fixed lower-left HTML panel (yes, real DOM), padded 24px, brand purple text. Heading: `WHAT ARE YOU LOOKING FOR?`. Five `->` category links matching the content's tags. Below them, a pill button labeled `ASK ME ANYTHING...` that expands to a textarea on click. Textarea posts to `/api/search` with the query; backend runs cosine similarity over precomputed embeddings of `name + description + tags` and returns the top-3 slugs. The renderer dollies the camera to the first match.

### G. "Add the WebGL-rendered project tiles"
> Rounded-rect plane geometry, ~16:9. Material: video texture sampled through a frosted-glass surface. Surface params: `roughness` blends from `0.0` (square-on to camera) to `0.6` (oblique), `dispersion` 0.015, refraction passes through a low-res back-buffer. Tile transforms come from an array of `{position, rotation, scale, videoSrc, projectId}`; up to 3 tiles active at once, staggered ±0.5 on Z. Click → opens a fullscreen DOM `<video>` modal — do not try to play full case-study video as a GPU texture, switch to native HTML5 playback.

### H. "Mirror every interactive into accessible DOM"
> For every visual button/link, append a hidden `<a class="link" href="#" aria-label="LABEL">LABEL</a>` to a single `<div class="GLA11y"><div class="NavigationUI">…</div></div>`. The visual element calls `dispatchEvent(new MouseEvent('click'))` on its DOM mirror when activated, so screen readers and Google's crawler always have a working tab order.

### I. "Use a single concatenated shader file"
> Bundle all shaders into one text file with a `{@}` separator between named blocks. At boot, fetch once, split, and register each named program with `Renderer.registerShader(name, vs, fs)`. This collapses ~120 round trips into one and makes the bundle highly compressible.

### J. "Use video textures for hero loops"
> Place a hidden `<div class="VideoTextures"><video src="loop.mp4" muted autoplay loop playsinline></video></div>` in the DOM. Upload the `<video>` element directly to a `WebGLTexture` each frame (or via `requestVideoFrameCallback` for cleaner timing). For the *case-study player* — the long-form video that opens on click — use a separate DOM `<video>` modal, not a texture, so the user gets native controls.

### K. "Use Basis + Draco for assets"
> Convert every PNG/JPG to `.ktx2` via `basisu -ktx2 -mipmap`. Convert every glTF to Draco via `gltf-pipeline -d`. Load both via web workers. Cache buster: append `?v=<unix-timestamp-of-build>` so CDN caches forever and a redeploy invalidates atomically.

### L. "CMS as static JSON on GCS"
> Three JSON files, versioned by URL query string:
> - `metadata.json` — site copy, social images, audio toggles
> - `contact.json` — emails, booking links, region defaults
> - `projects.json` — array of project objects (see §8 for shape)
> 
> Cache forever; redeploy by uploading new files + bumping the `?v=` param in the bootstrap fetch. No CMS server needed.

### M. "Match the brand typography"
> License **NB Architekt Std** (Neubau). Ship Light/Regular/Bold WOFF2 + WOFF + OTF for DOM use. Generate matching MSDF atlases (BMFont JSON + PNG) for in-canvas text. Default size: ~14px UI, ~32px headlines (DOM); in-canvas headlines scale to 12vw.

### N. "Replicate the loader's typographic sphere"
> Generate a `Geometry.Sphere(1, 64, 64)`. For each vertex, choose a glyph from `['/', '5', '7', '.']` (weighted to slashes). Each glyph is a quad billboarded toward the camera, sampled from the MSDF atlas. Rotate the sphere at 0.2rad/s. As assets load, advance a `uProgress` uniform; characters with `vGlyphIndex > uProgress * totalGlyphs` are alpha-zero.

### O. "Add spatial audio with material-aware reverb"
> Use **Google Resonance Audio** (or its WebAudio successor). Each biome carries a material name from the standard Resonance preset list (`ACOUSTIC_CEILING_TILES`, `BRICK_BARE`, `CONCRETE_BLOCK_COARSE`, `CURTAIN_HEAVY`, `FIBER_GLASS_INSULATION`, `GLASS_THICK`, …). On biome change, swap the room material and cross-fade the loop bus over 1s.

### P. "Detect device capability at runtime"
> ```js
> const capable = navigator.deviceMemory >= 4
>              && navigator.hardwareConcurrency >= 4
>              && document.createElement('canvas').getContext('webgl2');
> ```
> If `false`, drop radial blur and chromatic-aberration passes, halve particle counts, cap dpr at 1.0. Never gate features on UA strings.

---

## 18. What an Agent Should Specifically Avoid

- **Do not import Three.js** when asked for "Active Theory style" — they don't use it.
- **Do not add a custom DOM cursor** — the OS cursor is preserved; the "ring" you see is in WebGL.
- **Do not implement the full case-study video as a GPU texture** — switch to a native `<video>` modal once the user opens a project.
- **Do not skip the `aria-label` mirror** — the entire site's accessibility and SEO depend on it.
- **Do not animate scroll-driven content via `scrollTop` listeners** — the page never scrolls; consume `wheel`/`touchmove` directly.
- **Do not make the loader optional** — it's the brand's signature first impression and it's also where the audio context is unlocked.
- **Do not over-rely on per-frame `setTimeout` or `requestAnimationFrame` polyfills** — use a single render loop driven by `RenderManager`-style time accumulator with fixed-step physics + variable-step rendering.

---

## 19. File Layout to Recreate

```
public/
  assets/
    js/
      app.<ts>.js                ← main bundle
      modules.<ts>.js            ← lazy chunks
      hydra/hydra-thread.js      ← worker entry
      lib/
        _draco/draco_decoder.wasm
        _draco/draco_wasm_wrapper.js
        basis_transcoder.js
        basis_transcoder.wasm
        qrious.js
    shaders/
      compiled.vs                 ← single concatenated shader bundle ({@}-delimited)
    fonts/
      NBArchitektStd-{Regular,Light,Bold}.json   ← MSDF atlases
      NBArchitektStd-{...}-export/*.woff2|woff|otf
    data/
      uil.<ts>.json               ← UI layout + shader uniforms
    meta/
      manifest.json
      apple-touch-icon.png
      favicon-{16,32}x{16,32}.png
      safari-pinned-tab.svg
cms/                              ← served from object storage
  metadata-<env>.json
  contact-<env>.json
  projects-<env>.json
```

Filenames carry a 13-digit unix-ms timestamp = the build version.

---

## 20. Quick "vibes" checklist (use to grade output)

- [ ] Pure black background; one canvas; no visible scrollbar.
- [ ] Boot screen counts up, draws a typographic sphere, requires a click to enter.
- [ ] Top-right navigation pill with sine-wave divider.
- [ ] Glass-chrome `a` logo with rainbow IOR dispersion.
- [ ] Figure-8 / lemniscate ribbon underneath.
- [ ] Scrolling moves a marble through colored particle biomes.
- [ ] Project name shown in `<<  N. NAME  >>` pager.
- [ ] Lower-left chat panel reveals `WHAT ARE YOU LOOKING FOR?` with `->` category links + `ASK ME ANYTHING...` textarea.
- [ ] Project tiles are floating refractive glass slabs with video textures.
- [ ] Cookie banner: Accept / Reject + Notion-hosted privacy notice.
- [ ] Hidden `aria-label` mirrors of every interactive.
- [ ] All copy in NB Architekt Std, all-caps display.
- [ ] No third-party JS framework footprint visible in `window` — only the proprietary stack.

If all 13 boxes are checked, the build is on-brand.
