/**
 * WASM module loader for SVG OS.
 *
 * Loads the wasm-pack output and initializes the engine.
 * The WASM module is expected at ../wasm/svg_wasm.js (built by `just wasm`).
 */

export interface SvgOsWasm {
  svg_os_init(): void;
  svg_os_import_svg(svg: string): void;
  svg_os_export_svg(): string;
  svg_os_create_node(parent_id: string, tag: string, attrs_json: string): string;
  svg_os_remove_node(id: string): void;
  svg_os_set_attr(id: string, key: string, value: string): void;
  svg_os_remove_attr(id: string, key: string): void;
  svg_os_reparent(id: string, new_parent: string, index: number): void;
  svg_os_undo(): boolean;
  svg_os_redo(): boolean;
  svg_os_can_undo(): boolean;
  svg_os_can_redo(): boolean;
  svg_os_get_render_ops(): string;
  svg_os_full_render(): string;
  svg_os_get_document_json(): string;
  svg_os_root_id(): string;
  svg_os_defs_id(): string;

  // Phase 2
  svg_os_add_effect(node_id: string, effect_json: string): void;
  svg_os_remove_effect(node_id: string, index: number): void;
  svg_os_add_constraint(constraint_json: string): void;
  svg_os_solve_constraints(): void;
  svg_os_bind(binding_json: string): void;
  svg_os_evaluate_bindings(data_json: string): void;
  svg_os_apply_theme(theme_json: string): void;
  svg_os_instantiate_template(template_id: string, data_json: string): string;
  svg_os_repeat_template(template_id: string, rows_json: string, columns: number, gap_x: number, gap_y: number): string;
  svg_os_export_node_svg(node_id: string): string;
}

let wasmModule: SvgOsWasm | null = null;

/**
 * Load and initialize the SVG OS WASM module.
 * Call this once before using any other API.
 */
export async function loadWasm(wasmUrl?: string): Promise<SvgOsWasm> {
  if (wasmModule) return wasmModule;

  // Dynamic import of the wasm-pack generated JS glue
  const url = wasmUrl ?? new URL("../wasm/svg_wasm.js", import.meta.url).href;
  const mod = await import(/* @vite-ignore */ url);
  await mod.default();

  wasmModule = mod as unknown as SvgOsWasm;
  wasmModule.svg_os_init();

  return wasmModule;
}

/**
 * Get the loaded WASM module (throws if not loaded yet).
 */
export function getWasm(): SvgOsWasm {
  if (!wasmModule) throw new Error("WASM not loaded. Call loadWasm() first.");
  return wasmModule;
}
