# vid2gif

Pick individual frames from a video and assemble them into an optimized GIF.
Everything runs in the browser; nothing is uploaded anywhere.

```bash
npm install
npm run dev      # http://localhost:5181
npm run build    # static site in dist/
```

`launch.sh` starts the dev server if it is not already running and opens the
browser. On macOS you can wrap it in a double-clickable app on your Desktop:

```bash
osacompile -o ~/Desktop/vid2gif.app -e "do shell script \"$(pwd)/launch.sh >/dev/null 2>&1 &\""
```

## Deploy

The repo includes a `render.yaml` blueprint for a Render static site (build
with `npm ci && npm run build`, publish `dist/`). In Render, choose
**New → Blueprint**, point it at this repo, and accept the defaults. Any other
static host works the same way.

## How it works

1. **Load a video** – drag and drop or choose a file. Anything the browser can
   decode works (MP4/H.264, WebM, MOV, M4V, OGV). Formats the browser cannot
   decode (AVI, some MKV) show an error; convert those first.
2. **Pick frames** – scrub the timeline, step frame by frame (`←`/`→`, `shift`
   for ten), and press **Add frame** (`A` or `Enter`). The frame rate is
   detected on load and used for stepping; adjust it if the guess is wrong.
   "Add many frames at once" grabs every N-th of a second across a time range.
   Every selected frame shows as a dot on the timeline. Click a frame card to
   select it, then drag its dot (or use **Move frame N here**) to retime it
   without re-adding; the thumbnail updates on release.
3. **Arrange** – frames are always kept in video order regardless of the order
   you add them. Each frame has its own delay, skip, copy and remove controls,
   plus ezgif-style range tools (skip/enable a range, every N-th frame, set a
   delay for a range).
4. **Options** – global delay (1/100 s) with FPS readout, loop count, output
   size, color count, palette mode (global or per frame), dithering
   (none, Floyd–Steinberg, ordered).
5. **Optimization** – gifsicle compiled to WebAssembly runs on the encoded
   GIF: frame optimization levels 1–3 (`-O1`..`-O3`) and lossy compression
   (`--lossy=0..200`), the same knobs ezgif exposes. The result panel shows the
   size before and after optimization.

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4 + [shadcn/ui](https://ui.shadcn.com) (Radix primitives, Nova
  preset, Geist / Geist Mono, Lucide icons). Components live in
  `src/components/ui`; add more with `npx shadcn@latest add <name>`. The dark
  palette and acid-lime primary are overridden at the bottom of `src/index.css`.
- [gifenc](https://github.com/mattdesl/gifenc) for palette quantization and
  LZW encoding (runs in a Web Worker); dithering is implemented in
  `src/dither.ts`
- [gifsicle-wasm-browser](https://github.com/renzhezhilu/gifsicle-wasm-browser)
  for `-O` / `--lossy` optimization
