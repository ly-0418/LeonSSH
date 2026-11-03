/** Session CRUD, credentials and known-host pins. */

import { invoke } from "@tauri-apps/api/core";

import { normalizeError } from "./errors";
import type { KnownHostEntry, SessionInput, SessionSummary } from "./types";

export async function listSessions(): Promise<SessionSummary[]> {
  try {
    return await invoke<SessionSummary[]>("session_list");
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function createSession(input: SessionInput): Promise<SessionSummary> {
  try {
    return await invoke<SessionSummary>("session_create", { input });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function updateSession(id: number, input: SessionInput): Promise<SessionSummary> {
  try {
    return await invoke<SessionSummary>("session_update", { id, input });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function deleteSession(id: number): Promise<void> {
  try {
    await invoke<void>("session_delete", { id });
  } catch (error) {
    throw normalizeError(error);
  }
}

/** Writes the password to the Windows Credential Manager, never to SQLite. */
export async function setSessionPassword(id: number, password: string): Promise<void> {
  try {
    await invoke<void>("session_set_password", { id, password });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function hasSessionPassword(id: number): Promise<boolean> {
  try {
    return await invoke<boolean>("session_has_password", { id });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function listKnownHosts(): Promise<KnownHostEntry[]> {
  try {
    return await invoke<KnownHostEntry[]>("known_hosts_list");
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function forgetKnownHost(endpoint: string): Promise<void> {
  try {
    await invoke<void>("known_hosts_forget", { endpoint });
  } catch (error) {
    throw normalizeError(error);
  }
}

/** TCP reachability check (3 second timeout); returns the latency in ms. */
export async function testConnection(host: string, port: number): Promise<number> {
  try {
    return await invoke<number>("test_connection", { host, port });
  } catch (error) {
    throw normalizeError(error);
  }
}
/** JSON snapshot of all profiles (no secrets). */
export async function exportSessionsJson(): Promise<string> {
  try {
    return await invoke<string>("session_export_json");
  } catch (error) {
    throw normalizeError(error);
  }
}

/** Imports profiles from a JSON snapshot; returns how many were added. */
export async function importSessionsJson(json: string): Promise<number> {
  try {
    return await invoke<number>("session_import_json", { json });
  } catch (error) {
    throw normalizeError(error);
  }
}