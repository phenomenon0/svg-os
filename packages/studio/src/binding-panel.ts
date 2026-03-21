/**
 * Binding panel — UI for mapping data columns to template slots.
 *
 * Shows template slots (elements with data-bind-*) on the left,
 * data columns on the right, with a dropdown per slot to pick
 * which column maps to it.
 */

import type { TemplateSlot } from "./template-bind.js";

export interface ColumnMapping {
  /** Maps template slot field name → data column name. */
  [slotField: string]: string;
}

/**
 * Render the binding panel into a container.
 * Returns the current column mapping and a cleanup function.
 */
export function renderBindingPanel(
  container: HTMLElement,
  slots: TemplateSlot[],
  dataColumns: string[],
  initialMapping: ColumnMapping,
  onChange: (mapping: ColumnMapping) => void,
): { getMapping: () => ColumnMapping; cleanup: () => void } {
  container.innerHTML = "";

  const mapping: ColumnMapping = { ...initialMapping };

  const heading = document.createElement("h2");
  heading.textContent = "Field Mapping";
  heading.className = "panel-heading";
  container.appendChild(heading);

  if (slots.length === 0) {
    const empty = document.createElement("p");
    empty.className = "panel-empty";
    empty.textContent = "No bindable fields in this template.";
    container.appendChild(empty);
    return { getMapping: () => mapping, cleanup: () => { container.innerHTML = ""; } };
  }

  if (dataColumns.length === 0) {
    const empty = document.createElement("p");
    empty.className = "panel-empty";
    empty.textContent = "Upload data to map fields.";
    container.appendChild(empty);
    return { getMapping: () => mapping, cleanup: () => { container.innerHTML = ""; } };
  }

  for (const slot of slots) {
    const row = document.createElement("div");
    row.className = "binding-row";

    const label = document.createElement("div");
    label.className = "binding-label";

    const typeTag = document.createElement("span");
    typeTag.className = `binding-type binding-type-${slot.type}`;
    typeTag.textContent = slot.type === "text" ? "Aa" : slot.type === "color" ? "#" : "123";
    label.appendChild(typeTag);

    const fieldName = document.createElement("span");
    fieldName.className = "binding-field";
    fieldName.textContent = slot.field;
    label.appendChild(fieldName);

    row.appendChild(label);

    const arrow = document.createElement("span");
    arrow.className = "binding-arrow";
    arrow.textContent = "\u2190";
    row.appendChild(arrow);

    const select = document.createElement("select");
    select.className = "binding-select";

    // "Unmapped" option
    const unmapped = document.createElement("option");
    unmapped.value = "";
    unmapped.textContent = "-- unmapped --";
    select.appendChild(unmapped);

    for (const col of dataColumns) {
      const opt = document.createElement("option");
      opt.value = col;
      opt.textContent = col;
      select.appendChild(opt);
    }

    // Auto-map: if a column name matches the slot field name, select it
    const autoMatch = dataColumns.find(
      (c) => c.toLowerCase() === slot.field.toLowerCase(),
    );
    if (autoMatch && !mapping[slot.field]) {
      mapping[slot.field] = autoMatch;
    }
    select.value = mapping[slot.field] ?? "";

    select.addEventListener("change", () => {
      if (select.value) {
        mapping[slot.field] = select.value;
      } else {
        delete mapping[slot.field];
      }
      onChange(mapping);
    });

    row.appendChild(select);
    container.appendChild(row);
  }

  // Emit initial auto-mapping
  onChange(mapping);

  return {
    getMapping: () => ({ ...mapping }),
    cleanup: () => { container.innerHTML = ""; },
  };
}
