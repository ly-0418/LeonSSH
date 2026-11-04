/** Remembers how often each command was used so common ones rank first. */
const STORAGE_KEY = "leonssh.cmdUsage";

type Usage = Record<string, number>;

function read(): Usage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? {} : (JSON.parse(raw) as Usage);
  } catch {
    return {};
  }
}

export function usageOf(name: string): number {
  return read()[name] ?? 0;
}

export function bumpUsage(name: string): void {
  if (name.length === 0) {
    return;
  }
  const usage = read();
  usage[name] = (usage[name] ?? 0) + 1;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
  } catch {
    // Storage may be full/disabled; ranking simply stays empty.
  }
}
