/** Update check against GitHub Releases.
 *
 * Only queries the public `releases/latest` endpoint and compares the tag with
 * the version baked into the binary; it never downloads or installs anything.
 * Network failures are reported as `error` so the UI can stay quiet.
 */

import { invoke } from "@tauri-apps/api/core";

const RELEASES_API = "https://api.github.com/repos/ly-0418/LeonSSH/releases/latest";
const RELEASES_PAGE = "https://github.com/ly-0418/LeonSSH/releases/latest";

export interface UpdateInfo {
  /** Version without the leading `v`, e.g. `0.4.2`. */
  version: string;
  /** Release page to open in the browser. */
  url: string;
  /** Release notes (markdown as authored on GitHub). */
  notes: string;
}

export type UpdateCheck =
  | { kind: "update"; info: UpdateInfo }
  | { kind: "current" }
  | { kind: "error"; message: string };

const CACHE_TTL_MS = 30 * 60 * 1000;

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
    if (typeof parsed.at !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // storage full / private mode: caching is optional
  }
}

/** Mirrors a failure into the app log so support can see what WebView2 got. */
function logFailure(scope: string, message: string): void {
  void invoke("frontend_error", { message: `update-check/${scope}: ${message}` }).catch(() => undefined);
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
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

/** True when `latest` is strictly newer than `current`. */
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

/** Queries GitHub and classifies the result; never throws. */
export async function checkForUpdate(
  currentVersion: string,
  options: { force?: boolean } = {},
): Promise<UpdateCheck> {
  // The unauthenticated API allows 60 requests per hour; cache results so a
  // few opens of the settings tab cannot exhaust the quota.
  const cached = readCache<UpdateCheck>("leonssh.updateCache");
  if (options.force !== true && cached !== null && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const reason =
        response.status === 403
          ? "GitHub 接口限流（未登录每小时 60 次），请稍后再试或直接打开发布页"
          : `HTTP ${response.status}`;
      logFailure("latest", reason);
      // A stale cached answer (even "current") still beats an error banner.
      return cached?.value ?? { kind: "error", message: reason };
    }
    const data = (await response.json()) as GitHubRelease;
    if (data.draft === true || data.prerelease === true) {
      return { kind: "current" };
    }
    const version = (data.tag_name ?? "").replace(/^v/i, "").trim();
    if (version.length === 0) {
      logFailure("latest", "response has no tag_name");
      return { kind: "error", message: "响应缺少版本号" };
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
        url: data.html_url ?? RELEASES_PAGE,
        notes: data.body ?? "",
      },
    };
    writeCache("leonssh.updateCache", result);
    return result;
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    logFailure("latest", reason);
    return cached?.value ?? { kind: "error", message: reason };
  } finally {
    window.clearTimeout(timer);
  }
}

export interface ReleaseNote {
  version: string;
  title: string;
  publishedAt: string | null;
  notes: string;
  url: string;
  prerelease: boolean;
}

interface GitHubReleaseListEntry extends GitHubRelease {
  name?: string;
  published_at?: string;
}

/** Reads the newest releases (GitHub returns them newest first). */
export async function fetchRecentReleases(limit = 10): Promise<ReleaseNote[]> {
  const cacheKey = `leonssh.releaseList.${limit}`;
  const cached = readCache<ReleaseNote[]>(cacheKey);
  if (cached !== null && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(`${RELEASES_API.replace(/\/latest$/, "")}?per_page=${limit}`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      logFailure("list", `HTTP ${response.status}`);
      return cached?.value ?? [];
    }
    const data = (await response.json()) as GitHubReleaseListEntry[];
    if (!Array.isArray(data)) {
      return [];
    }
    const mapped = data
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
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    logFailure("list", reason);
    return cached?.value ?? [];
  } finally {
    window.clearTimeout(timer);
  }
}
