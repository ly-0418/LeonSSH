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
