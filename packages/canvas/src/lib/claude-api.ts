/**
 * Claude API client — calls Anthropic Messages API from the browser.
 * API key stored in localStorage.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const STORAGE_KEY_API = "svgos:claude-api-key";
const STORAGE_KEY_MODEL = "svgos:claude-model";
const DEFAULT_MODEL = "claude-opus-4-6";

export function getApiKey(): string {
  return localStorage.getItem(STORAGE_KEY_API) || "";
}

export function setApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY_API, key);
}

export function getModel(): string {
  return localStorage.getItem(STORAGE_KEY_MODEL) || DEFAULT_MODEL;
}

export function setModel(model: string): void {
  localStorage.setItem(STORAGE_KEY_MODEL, model);
}

export async function callClaude(
  prompt: string,
  context?: Record<string, unknown>,
): Promise<{ text: string; error?: string }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { text: "", error: "No API key set. Open Settings to configure." };
  }

  // Interpolate {{field}} placeholders
  let resolvedPrompt = prompt;
  if (context && Object.keys(context).length > 0) {
    resolvedPrompt = prompt.replace(/\{\{(\w+)\}\}/g, (_m, field) => {
      return context[field] != null ? String(context[field]) : `{{${field}}}`;
    });

    // Append context as JSON if there are uninterpolated values
    const contextStr = JSON.stringify(context, null, 2);
    if (contextStr !== "{}") {
      resolvedPrompt += `\n\nContext data:\n${contextStr}`;
    }
  }

  const model = getModel();

  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: resolvedPrompt }],
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      return { text: "", error: `API ${resp.status}: ${errBody.slice(0, 200)}` };
    }

    const data = await resp.json();
    const text = data.content
      ?.map((block: { type: string; text?: string }) =>
        block.type === "text" ? block.text : ""
      )
      .join("") || "";

    return { text };
  } catch (err) {
    return {
      text: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Test the API key with a minimal request.
 */
export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, error: "No API key" };

  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: getModel(),
        max_tokens: 10,
        messages: [{ role: "user", content: "Say OK" }],
      }),
    });

    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
