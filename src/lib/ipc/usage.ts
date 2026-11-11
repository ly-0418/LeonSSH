import { invoke } from "@tauri-apps/api/core";

/** Usage counters live in the app database, so they survive restarts/upgrades. */
export async function loadCommandUsage(): Promise<Record<string, number>> {
  try {
    const rows = await invoke<Array<[string, number]>>("command_usage_list");
    return Object.fromEntries(rows);
  } catch {
    return {};
  }
}

export async function bumpCommandUsage(name: string): Promise<void> {
  try {
    await invoke("command_usage_bump", { name });
  } catch {
    // Ranking is a nicety; failures must never block typing.
  }
}

export async function loadSnippets(): Promise<Record<string, number>> {
  try {
    const rows = await invoke<Array<[string, number]>>("command_snippet_list");
    return Object.fromEntries(rows);
  } catch {
    return {};
  }
}

export async function bumpSnippet(line: string): Promise<void> {
  try {
    await invoke("command_snippet_bump", { line });
  } catch {
    // Learning is best-effort.
  }
}
/** Learned snippet plus the user's override (edited text or hidden). */
export interface SnippetEntry {
  original: string;
  template: string;
  count: number;
  edited: boolean;
  deleted: boolean;
}

export async function loadSnippetCatalog(): Promise<SnippetEntry[]> {
  try {
    return await invoke<SnippetEntry[]>("command_snippet_catalog");
  } catch {
    return [];
  }
}

export async function setSnippetOverride(
  original: string,
  template: string,
  deleted: boolean,
): Promise<void> {
  await invoke("command_snippet_override_set", { original, template, deleted });
}

export async function clearSnippetOverride(original: string): Promise<void> {
  await invoke("command_snippet_override_clear", { original });
}
