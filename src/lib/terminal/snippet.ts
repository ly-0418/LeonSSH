/**
 * Turns an executed command line into a reusable "fixed combination".
 *
 * Variable tokens (ports, PIDs, IPs, file paths) become placeholders so that
 * `ss -lntp | grep 8080` is remembered as `ss -lntp | grep {n}` instead of a
 * line that will never match again.
 */
const PLACEHOLDER = /\{(?:n|ip|path)\}/g;

function isNumberToken(token: string): boolean {
  return /^\d{1,6}$/.test(token);
}

function isNetworkToken(token: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$/.test(token)) {
    return true;
  }
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+:\d{1,5}$/i.test(token);
}

function isPathToken(token: string): boolean {
  if (token.startsWith("-")) {
    return false;
  }
  return (
    token.startsWith("/") ||
    token.startsWith("./") ||
    token.startsWith("../") ||
    token.startsWith("~/") ||
    /^[a-z]:\\/i.test(token)
  );
}

/** Template with placeholders, e.g. `ss -lntp | grep {n}`. */
export function snippetTemplate(line: string): string | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 2) {
    return null;
  }
  const normalized = tokens.map((token) => {
    if (token === "|" || token === "||" || token === "&&") {
      return token;
    }
    if (isNumberToken(token)) {
      return "{n}";
    }
    if (isNetworkToken(token)) {
      return "{ip}";
    }
    if (isPathToken(token)) {
      return "{path}";
    }
    return token;
  });
  return normalized.join(" ");
}

/** What to insert into the command line (placeholders stripped, trailing space). */
export function snippetInsertion(template: string): string {
  const stripped = template.replace(PLACEHOLDER, "").replace(/\s+/g, " ").trimEnd();
  return template.endsWith("{n}") || template.endsWith("{ip}") || template.endsWith("{path}")
    ? `${stripped} `
    : stripped;
}
