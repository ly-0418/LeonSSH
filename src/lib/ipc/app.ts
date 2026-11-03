import { invoke } from "@tauri-apps/api/core";

/** Version string baked into the binary at build time. */
export async function appVersion(): Promise<string> {
  return invoke<string>("app_version");
}
