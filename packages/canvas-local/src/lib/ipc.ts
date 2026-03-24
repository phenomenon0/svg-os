import { invoke } from "@tauri-apps/api/core";

// Graph commands
export async function graphAddNode(nodeType: string, config?: any, id?: string) {
  return invoke<{ id: string }>("graph_add_node", { request: { node_type: nodeType, config, id } });
}
export async function graphRemoveNode(nodeId: string) {
  return invoke("graph_remove_node", { nodeId });
}
export async function graphUpdateNode(nodeId: string, config?: any, data?: any) {
  return invoke("graph_update_node", { request: { node_id: nodeId, config, data } });
}
export async function graphAddEdge(fromNode: string, fromPort: string, toNode: string, toPort: string, id?: string) {
  return invoke<{ id: string }>("graph_add_edge", { request: { from_node: fromNode, from_port: fromPort, to_node: toNode, to_port: toPort, id } });
}
export async function graphRemoveEdge(edgeId: string) {
  return invoke("graph_remove_edge", { edgeId });
}
export async function graphGetSnapshot() {
  return invoke<any>("graph_get_snapshot");
}
export async function graphLoadSnapshot(snapshot: any) {
  return invoke("graph_load_snapshot", { snapshot });
}
export async function graphUndo() {
  return invoke<any>("graph_undo");
}
export async function graphRedo() {
  return invoke<any>("graph_redo");
}
export async function graphRegisterNodeDef(def: any) {
  return invoke("graph_register_node_def", { def });
}

// Store commands
export async function storeSave(name?: string, tldrawSnapshot?: Uint8Array) {
  return invoke<number>("store_save", { name, tldrawSnapshot: tldrawSnapshot ? Array.from(tldrawSnapshot) : null });
}
export async function storeAutosave(tldrawSnapshot?: Uint8Array) {
  return invoke<number>("store_autosave", { tldrawSnapshot: tldrawSnapshot ? Array.from(tldrawSnapshot) : null });
}
export async function storeLoadLatest() {
  return invoke<number[] | null>("store_load_latest");
}
export async function storeList() {
  return invoke<any[]>("store_list");
}
export async function storeGetSetting(key: string) {
  return invoke<string | null>("store_get_setting", { key });
}
export async function storeSetSetting(key: string, value: string) {
  return invoke("store_set_setting", { key, value });
}

// Code execution
export async function execRun(lang: string, code: string, cwd?: string, stdin?: string) {
  return invoke<{ stdout: string; stderr: string; exit_code: number }>("exec_run", { lang, code, cwd, stdin });
}
export async function execRunRepl(lang: string, code: string, contextJson?: string) {
  return invoke<{ stdout: string; stderr: string; exit_code: number }>("exec_run_repl", { lang, code, contextJson });
}

// PTY
export async function ptySpawn(nodeId: string, opts?: { shell?: string; cwd?: string; cols?: number; rows?: number }) {
  return invoke<{ id: string; shell: string; cwd: string; alive: boolean }>("pty_spawn", { nodeId, ...opts });
}
export async function ptyWrite(nodeId: string, data: string) {
  return invoke("pty_write", { nodeId, data });
}
export async function ptyResize(nodeId: string, cols: number, rows: number) {
  return invoke("pty_resize", { nodeId, cols, rows });
}
export async function ptyKill(nodeId: string) {
  return invoke("pty_kill", { nodeId });
}

// System
export async function getShell() {
  return invoke<string>("get_shell");
}
export async function getHomeDir() {
  return invoke<string>("get_home_dir");
}
