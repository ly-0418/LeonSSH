import { invoke } from "@tauri-apps/api/core";

/** Version string baked into the binary at build time. */
export async function appVersion(): Promise<string> {
  return invoke<string>("app_version");
}

/** Opens an https URL (release page) in the system browser. */
export async function openExternalUrl(url: string): Promise<void> {
  await invoke("open_external_url", { url });
}

