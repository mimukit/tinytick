// Builds the Raycast-format extension Tinycast loads: dist/package.json,
// dist/assets/, and one CommonJS bundle per command. With --install, it also
// copies dist/ into Tinycast's extensions folder.
import { build } from "esbuild";
import { builtinModules } from "node:module";
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const manifest = JSON.parse(readFileSync(join(root, "src/manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const MAX_BYTES = 300 * 1024;

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "assets"), { recursive: true });

const external = [
  "react",
  "react/jsx-runtime",
  "@raycast/api",
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

await build({
  entryPoints: Object.fromEntries(manifest.commands.map((c) => [c.name, join(root, "src/commands", `${c.name}.tsx`)])),
  outdir: dist,
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2022",
  jsx: "automatic",
  minify: !process.argv.includes("--dev"),
  external,
  logLevel: "warning",
});

writeFileSync(join(dist, "package.json"), JSON.stringify({ ...manifest, version: pkg.version }, null, 2) + "\n");
cpSync(join(root, "assets"), join(dist, "assets"), { recursive: true });

let failed = false;
for (const c of manifest.commands) {
  const size = statSync(join(dist, `${c.name}.js`)).size;
  const over = size > MAX_BYTES;
  failed ||= over;
  console.log(`${over ? "OVER" : "ok  "} ${c.name}.js ${(size / 1024).toFixed(1)} KB`);
}
if (failed) {
  console.error(`A command bundle is over ${MAX_BYTES / 1024} KB.`);
  process.exit(1);
}

if (process.argv.includes("--install")) {
  const bundleId = process.env.TINYCAST_BUNDLE_ID ?? "com.tinycast.app";
  const target =
    process.env.TINYCAST_EXT_DIR ?? join(homedir(), "Library/Application Support", bundleId, "extensions", manifest.name);
  if (!existsSync(join(target, ".."))) {
    console.error(`No Tinycast extensions folder at ${join(target, "..")}. Install once with "Add from folder", or set TINYCAST_EXT_DIR.`);
    process.exit(1);
  }
  rmSync(target, { recursive: true, force: true });
  cpSync(dist, target, { recursive: true });
  console.log(`Installed to ${target}`);
}
