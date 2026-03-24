/**
 * Connection Assistant — AI-powered popup for configuring connectors.
 *
 * Shows source output schema, target input slots, suggested field mappings,
 * and a DataFlow picker when a new connection is created between nodes.
 */

import { suggestConnection, getNodeInfo, setNodeRole } from "@svg-os/bridge";
import type { ConnectionSuggestion, SuggestedMapping, NodeRole, DataFlow } from "@svg-os/bridge";

interface AssistantCallbacks {
  onApply: (dataFlow: DataFlow) => void;
  onDismiss: () => void;
}

let activePanel: HTMLElement | null = null;

/** Show the connection assistant popup near the target port. */
export function showConnectionAssistant(
  fromId: string,
  toId: string,
  anchorX: number,
  anchorY: number,
  callbacks: AssistantCallbacks,
): void {
  // Remove any existing panel
  dismissAssistant();

  // Get suggestion from WASM
  let suggestion: ConnectionSuggestion;
  try {
    suggestion = suggestConnection(fromId, toId);
  } catch {
    // If suggestion fails, just use defaults
    callbacks.onApply("PassThrough");
    return;
  }

  // Get node info for display
  const fromInfo = safeGetNodeInfo(fromId);
  const toInfo = safeGetNodeInfo(toId);

  // Build the popup
  const panel = document.createElement("div");
  panel.className = "connection-assistant";
  panel.style.cssText = `
    position: fixed;
    left: ${anchorX + 16}px;
    top: ${anchorY - 8}px;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 12px 16px;
    min-width: 280px;
    max-width: 360px;
    color: #e2e8f0;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    z-index: 10000;
  `;

  // Header
  const header = document.createElement("div");
  header.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;";
  header.innerHTML = `
    <span style="font-weight: 600; font-size: 13px; color: #818cf8;">Connection</span>
    <button class="ca-close" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 16px; padding: 0;">&times;</button>
  `;
  panel.appendChild(header);

  // From → To
  const flow = document.createElement("div");
  flow.style.cssText = "color: #94a3b8; margin-bottom: 10px; font-size: 11px;";
  flow.textContent = `${fromInfo.name || fromInfo.tag} → ${toInfo.name || toInfo.tag}`;
  panel.appendChild(flow);

  // Suggested mappings
  if (suggestion.suggested_mappings.length > 0) {
    const mappingsDiv = document.createElement("div");
    mappingsDiv.style.cssText = "margin-bottom: 10px;";

    const mappingsLabel = document.createElement("div");
    mappingsLabel.style.cssText = "color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;";
    mappingsLabel.textContent = "Suggested Mappings";
    mappingsDiv.appendChild(mappingsLabel);

    for (const m of suggestion.suggested_mappings) {
      const row = document.createElement("div");
      row.style.cssText = "display: flex; align-items: center; gap: 6px; padding: 3px 0;";
      const conf = Math.round(m.confidence * 100);
      row.innerHTML = `
        <span style="color: #e2e8f0; font-family: monospace;">${m.source_field}</span>
        <span style="color: #64748b;">→</span>
        <span style="color: #818cf8; font-family: monospace;">${m.target_slot}</span>
        <span style="color: ${conf >= 80 ? '#22c55e' : conf >= 50 ? '#eab308' : '#94a3b8'}; font-size: 10px; margin-left: auto;">${conf}%</span>
      `;
      mappingsDiv.appendChild(row);
    }
    panel.appendChild(mappingsDiv);
  }

  // Data flow selector
  const flowSelect = document.createElement("div");
  flowSelect.style.cssText = "margin-bottom: 10px;";

  const flowLabel = document.createElement("div");
  flowLabel.style.cssText = "color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;";
  flowLabel.textContent = "Data Flow";
  flowSelect.appendChild(flowLabel);

  const select = document.createElement("select");
  select.style.cssText = `
    width: 100%; padding: 6px 8px; background: #0f172a; border: 1px solid #334155;
    border-radius: 4px; color: #e2e8f0; font-size: 12px; font-family: inherit;
  `;

  const options: Array<{ value: string; label: string; dataFlow: DataFlow }> = [
    { value: "PassThrough", label: "Pass all data", dataFlow: "PassThrough" },
    { value: "None", label: "Visual only (no data)", dataFlow: "None" },
  ];

  // Add field options from suggestions
  if (suggestion.suggested_mappings.length > 0) {
    for (const m of suggestion.suggested_mappings) {
      options.splice(1, 0, {
        value: `Field:${m.source_field}`,
        label: `Pass field: ${m.source_field}`,
        dataFlow: { Field: m.source_field },
      });
    }
  }

  // Select the suggested default
  let defaultValue = "PassThrough";
  const suggested = suggestion.suggested_data_flow;
  if (typeof suggested === "string") {
    defaultValue = suggested;
  } else if ("Field" in suggested) {
    defaultValue = `Field:${suggested.Field}`;
  }

  for (const opt of options) {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.label;
    if (opt.value === defaultValue) el.selected = true;
    select.appendChild(el);
  }
  flowSelect.appendChild(select);
  panel.appendChild(flowSelect);

  // Buttons
  const buttons = document.createElement("div");
  buttons.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
  buttons.innerHTML = `
    <button class="ca-dismiss" style="padding: 5px 12px; background: transparent; border: 1px solid #334155; border-radius: 4px; color: #94a3b8; cursor: pointer; font-size: 12px;">Skip</button>
    <button class="ca-apply" style="padding: 5px 12px; background: #818cf8; border: none; border-radius: 4px; color: #fff; cursor: pointer; font-size: 12px; font-weight: 500;">Apply</button>
  `;
  panel.appendChild(buttons);

  // Event handlers
  panel.querySelector(".ca-close")?.addEventListener("click", () => {
    dismissAssistant();
    callbacks.onDismiss();
  });

  panel.querySelector(".ca-dismiss")?.addEventListener("click", () => {
    dismissAssistant();
    callbacks.onDismiss();
  });

  panel.querySelector(".ca-apply")?.addEventListener("click", () => {
    const selectedOpt = options.find(o => o.value === select.value);
    const dataFlow = selectedOpt?.dataFlow ?? "PassThrough";
    dismissAssistant();
    callbacks.onApply(dataFlow);
  });

  document.body.appendChild(panel);
  activePanel = panel;

  // Dismiss on escape
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      dismissAssistant();
      callbacks.onDismiss();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);
}

/** Dismiss the connection assistant popup. */
export function dismissAssistant(): void {
  if (activePanel) {
    activePanel.remove();
    activePanel = null;
  }
}

function safeGetNodeInfo(id: string): { tag: string; name: string | null; attrs: Record<string, string> } {
  try {
    return getNodeInfo(id) as { tag: string; name: string | null; attrs: Record<string, string> };
  } catch {
    return { tag: "unknown", name: null, attrs: {} };
  }
}
