# SVG OS

**A programmable document engine for SVG.**

SVG OS is a Rust kernel compiled to WebAssembly with a TypeScript frontend.
It combines an interactive visual editor with a batch automation studio --
design SVG documents by hand, or generate hundreds from templates and data.
All mutations flow through a command system with full undo/redo.

---

## Architecture

```
 +-------------------------------------------------+
 |              TypeScript Layer                    |
 |                                                 |
 |   editor         Interactive design surface     |
 |   studio         Batch automation + templates   |
 +-------------------------------------------------+
              |                        |
 +-------------------------------------------------+
 |   @svg-os/bridge                                |
 |   WASM loader + DOM reconciler                  |
 +-------------------------------------------------+
              |
 +-------------------------------------------------+
 |              Rust Kernel (WASM)                  |
 |                                                 |
 |   svg-doc      svg-geom      svg-render         |
 |   svg-text     svg-effects   svg-layout         |
 |   svg-runtime  svg-wasm                         |
 +-------------------------------------------------+
```

---

## Crates

| Crate | Purpose |
|---|---|
| `svg-doc` | Document tree -- nodes, typed attributes, command-based mutations, SVG parse/serialize |
| `svg-geom` | Geometry primitives -- paths, hit-testing, bounding boxes (wraps kurbo) |
| `svg-render` | Diff engine -- computes minimal DOM operations from document state |
| `svg-text` | Text layout, measurement, and font attribute handling |
| `svg-effects` | Visual effects store -- filters, gradients, blend modes |
| `svg-layout` | Constraint solver for spatial relationships between nodes |
| `svg-runtime` | Binding engine, theming, template instantiation |
| `svg-wasm` | WASM entry point -- flat `wasm_bindgen` API consumed by the bridge |

## Packages

| Package | Purpose |
|---|---|
| `@svg-os/bridge` | TypeScript wrapper over the WASM module -- loads the engine, exposes typed functions, reconciles render ops to the DOM |
| `@svg-os/editor` | Interactive design surface -- canvas, selection, property panels |
| `@svg-os/studio` | Batch automation UI -- bind data to templates, preview, bulk export |

## Templates

13 SVG templates live in `fixtures/templates/`. Game-inspired designs (achievement badges, HUD profiles, scouting reports, shader cards) alongside professional layouts (pricing cards, portfolio cards, brand showcases, event flyers).

---

## Getting Started

Requires: Rust, wasm-pack, Node 20+, pnpm.

```sh
# Build the WASM module
just wasm

# Run the interactive editor
just dev

# Run the automation studio
just dev-studio

# Run all tests (Rust + TypeScript)
just test-all
```

## Tech Stack

- **Rust 2021** -- workspace of 8 crates, optimized for size (`opt-level = "z"`, LTO)
- **WebAssembly** -- built with wasm-pack, targeting the web
- **TypeScript** -- Vite-based frontend, pnpm workspace
- **Rendering** -- DOM reconciliation via render ops; WebGPU/WebGL2 shader pipeline
- **Geometry** -- kurbo for curves, forge-math for primitives
- **Serialization** -- quick-xml for SVG, serde for JSON interchange

## Status

Phase 3 -- v0.1.0. Local development. Not yet published.

---

MIT License.
