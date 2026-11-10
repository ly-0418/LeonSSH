/** Update check against GitHub Releases.
 *
 * Only queries the public `releases/latest` endpoint and compares the tag with
 * the version baked into the binary; it never downloads or installs anything.
 * Network failures are reported as `error` so the UI can stay quiet.
 */

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
  | { kind: "error" };

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
export async function checkForUpdate(currentVersion: string): Promise<UpdateCheck> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return { kind: "error" };
    }
    const data = (await response.json()) as GitHubRelease;
    if (data.draft === true || data.prerelease === true) {
      return { kind: "current" };
    }
    const version = (data.tag_name ?? "").replace(/^v/i, "").trim();
    if (version.length === 0) {
      return { kind: "error" };
    }
    if (!isNewerVersion(version, currentVersion)) {
      return { kind: "current" };
    }
    return {
      kind: "update",
      info: {
        version,
        url: data.html_url ?? RELEASES_PAGE,
        notes: data.body ?? "",
      },
    };
  } catch {
    return { kind: "error" };
  } finally {
    window.clearTimeout(timer);
  }
}
