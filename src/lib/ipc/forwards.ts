/** Port forwarding IPC (-L / -R / -D). */

import { invoke } from "@tauri-apps/api/core";

import { normalizeError } from "./errors";

export interface ForwardView {
  id: number;
  sessionId: number;
  kind: "local" | "remote" | "dynamic" | string;
  bindHost: string;
  bindPort: number;
  targetHost: string | null;
  targetPort: number | null;
  running: boolean;
}

export interface NewForwardInput {
  sessionId: number;
  kind: string;
  bindHost: string;
  bindPort: number;
  targetHost?: string | null;
  targetPort?: number | null;
}

export async function listForwards(sessionId: number): Promise<ForwardView[]> {
  try {
    return await invoke<ForwardView[]>("forward_list", { sessionId });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function createForward(input: NewForwardInput): Promise<ForwardView> {
  try {
    return await invoke<ForwardView>("forward_create", { input });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function deleteForward(id: number): Promise<void> {
  try {
    await invoke<void>("forward_delete", { id });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function startForward(terminalId: string, id: number): Promise<ForwardView> {
  try {
    return await invoke<ForwardView>("forward_start", { terminalId, id });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function stopForward(id: number): Promise<ForwardView> {
  try {
    return await invoke<ForwardView>("forward_stop", { id });
  } catch (error) {
    throw normalizeError(error);
  }
}

/** Starts every saved rule of the session (called once the terminal is ready). */
export async function startAllForwards(terminalId: string, sessionId: number): Promise<number> {
  try {
    return await invoke<number>("forward_start_all", { terminalId, sessionId });
  } catch (error) {
    throw normalizeError(error);
  }
}