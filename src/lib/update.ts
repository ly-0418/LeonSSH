/** Update check against GitHub Releases, with domestic mirror fallbacks.
 *
 * The public GitHub API allows only 60 anonymous requests per hour per IP, and
 * it is slow/blocked on some Chinese networks. We therefore try the official
 * endpoint first and fall back to a mirror that proxies the same JSON; the last
 * base that worked is remembered so later checks start there.
 *
 * Only public release metadata is fetched; nothing is downloaded or installed.
 */

import { invoke } from "@tauri-apps/api/core";

const RELEASES_PAGE = "https://github.com/ly-0418/LeonSSH/releases/latest";
const REPO_PATH = "/repos/ly-0418/LeonSSH";
const BASE_CACHE_KEY = "leonssh.updateBase";
const CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 7000;

/** Bases that return the GitHub REST payload (direct or proxied). */
const API_BASES = [
  "https://api.github.com",
  "https://gh-proxy.com/https://api.github.com",
  "https://api.kkgithub.com",
];

export interface UpdateInfo {
  version: string;
  url: string;
  notes: string;
}

export type UpdateCheck =
  | { kind: "update"; info: UpdateInfo }
  | { kind: "current" }
  | { kind: "error"; message: string };

export interface ReleaseNote {
  version: string;
  title: string;
  publishedAt: string | null;
  notes: string;
  url: string;
  prerelease: boolean;
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  name?: string;
  published_at?: string;
}

interface Cached<T> {
  at: number;
  value: T;
}

function readCache<T>(key: string): Cached<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as Cached<T>;
    return typeof parsed.at === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // storage unavailable: caching is optional
  }
}

/** Mirrors a failure into the app log so support can see what WebView2 got. */
function logFailure(scope: string, message: string): void {
  void invoke("frontend_error", { message: `update-check/${scope}: ${message}` }).catch(() => undefined);
}

function orderedBases(): string[] {
  const remembered = localStorage.getItem(BASE_CACHE_KEY);
  if (remembered !== null && API_BASES.includes(remembered)) {
    return [remembered, ...API_BASES.filter((base) => base !== remembered)];
  }
  return [...API_BASES];
}

interface ApiResult {
  data: unknown;
  status: number;
  base: string;
}

/**
 * Fetches `REPO_PATH + path` from the first base that answers 2xx.
 * Errors are aggregated into a single message for the UI.
 */
async function requestRepoJson(path: string): Promise<ApiResult> {
  const failures: string[] = [];
  for (const base of orderedBases()) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${base}${REPO_PATH}${path}`, {
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
        cache: "no-store",
      });
      if (response.ok) {
        const data = (await response.json()) as unknown;
        try {
          localStorage.setItem(BASE_CACHE_KEY, base);
        } catch {
          // ignore storage failures
        }
        return { data, status: response.status, base };
      }
      failures.push(`${new URL(base).host}: HTTP ${response.status}`);
    } catch (error) {
      const reason = error instanceof Error ? error.name : "network error";
      failures.push(`${new URL(base).host}: ${reason}`);
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw new Error(failures.join("；"));
}

/** Splits `1.2.3-beta.1` into numeric parts; missing parts count as 0. */
function parseVersion(value: string): number[] {
  const cleaned = value.trim().replace(/^v/i, "").split(/[+-]/)[0];
  const parts = cleaned.split(".").map((part) => {
    const matched = /^\d+/.exec(part);
    return matched === null ? 0 : Number.parseInt(matched[0], 10);
  });
  while (parts.length < 3) {
    parts.push(0);
  }
  return parts.slice(0, 3);
}

export function isNewerVersion(latest: string, current: string): boolean {
  const left = parseVersion(latest);
  const right = parseVersion(current);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] > right[index];
    }
  }
  return false;
}

export function releasesPageUrl(): string {
  return RELEASES_PAGE;
}

export async function checkForUpdate(
  currentVersion: string,
  options: { force?: boolean } = {},
): Promise<UpdateCheck> {
  const cached = readCache<UpdateCheck>("leonssh.updateCache");
  if (options.force !== true && cached !== null && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }
  try {
    const { data } = await requestRepoJson("/releases/latest");
    const release = data as GitHubRelease;
    if (release.draft === true || release.prerelease === true) {
      const current: UpdateCheck = { kind: "current" };
      writeCache("leonssh.updateCache", current);
      return current;
    }
    const version = (release.tag_name ?? "").replace(/^v/i, "").trim();
    if (version.length === 0) {
      throw new Error("响应缺少版本号");
    }
    if (!isNewerVersion(version, currentVersion)) {
      const current: UpdateCheck = { kind: "current" };
      writeCache("leonssh.updateCache", current);
      return current;
    }
    const result: UpdateCheck = {
      kind: "update",
      info: {
        version,
        url: release.html_url ?? RELEASES_PAGE,
        notes: release.body ?? "",
      },
    };
    writeCache("leonssh.updateCache", result);
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logFailure("latest", reason);
    return cached?.value ?? { kind: "error", message: reason };
  }
}

export async function fetchRecentReleases(limit = 10): Promise<ReleaseNote[]> {
  const cacheKey = `leonssh.releaseList.${limit}`;
  const cached = readCache<ReleaseNote[]>(cacheKey);
  if (cached !== null && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }
  try {
    // No query string: some proxies drop it, so fetch the default page and
    // slice locally.
    const { data } = await requestRepoJson("/releases");
    if (!Array.isArray(data)) {
      throw new Error("响应格式不正确");
    }
    const mapped = (data as GitHubRelease[])
      .filter((entry) => entry.draft !== true)
      .slice(0, limit)
      .map((entry) => ({
        version: (entry.tag_name ?? "").replace(/^v/i, "").trim(),
        title: entry.name ?? entry.tag_name ?? "",
        publishedAt: entry.published_at ?? null,
        notes: entry.body ?? "",
        url: entry.html_url ?? RELEASES_PAGE,
        prerelease: entry.prerelease === true,
      }))
      .filter((entry) => entry.version.length > 0);
    writeCache(cacheKey, mapped);
    return mapped;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logFailure("list", reason);
    return cached?.value ?? [];
  }
}
