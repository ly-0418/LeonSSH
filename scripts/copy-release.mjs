/**
 * Copies the freshly built artifacts into the project-level `release/` folder.
 *
 * Run automatically by `pnpm build:release` (see package.json); the Tauri build
 * itself keeps writing into `src-tauri/target/release`, so this script is the
 * single place that decides what "release" means for the project.
 */

import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "release");
const targetDir = path.join(root, "src-tauri", "target", "release");

const exe = path.join(targetDir, "leonssh.exe");
const bundleDir = path.join(targetDir, "bundle", "nsis");

if (!existsSync(exe)) {
  console.error(`[release] missing ${exe}; run \`pnpm tauri build\` first`);
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
await copyFile(exe, path.join(outDir, "leonssh.exe"));
console.log("[release] leonssh.exe");

// Only the installer for the current package version belongs in release/.
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (existsSync(bundleDir)) {
  const installers = (await readdir(bundleDir)).filter((entry) =>
    entry.toLowerCase().endsWith(".exe"),
  );
  const match = installers.find((entry) => entry.includes(`_${version}_`)) ?? installers.sort().at(-1);
  if (match !== undefined) {
    await copyFile(path.join(bundleDir, match), path.join(outDir, match));
    console.log(`[release] ${match}`);
  }
}

console.log(`[release] artifacts copied to ${outDir}`);
