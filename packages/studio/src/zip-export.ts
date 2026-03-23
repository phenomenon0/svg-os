/**
 * ZIP creation using fflate (8KB pure JS, zero deps).
 *
 * Takes an array of named blobs and packages them into a single ZIP file.
 */

import { zipSync, strToU8 } from "fflate";
import { getBoundedConcurrency, mapConcurrent } from "./concurrency.js";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Create a ZIP blob from an array of entries.
 */
export function createZip(entries: ZipEntry[]): Blob {
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    files[entry.name] = entry.data;
  }
  const zipped = zipSync(files);
  return new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" });
}

/**
 * Convert a Blob to Uint8Array for ZIP inclusion.
 */
export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Create a ZIP from named blobs (convenience wrapper).
 */
export async function createZipFromBlobs(
  items: { name: string; blob: Blob }[],
): Promise<Blob> {
  const concurrency = getBoundedConcurrency(8, 4);
  const entries = await mapConcurrent(
    items,
    concurrency,
    async (item) => ({
      name: item.name,
      data: await blobToUint8Array(item.blob),
    }),
    { yieldEvery: concurrency },
  );
  return createZip(entries);
}

/** Create a simple text file entry for the ZIP (e.g., manifest). */
export function textEntry(name: string, content: string): ZipEntry {
  return { name, data: strToU8(content) };
}
