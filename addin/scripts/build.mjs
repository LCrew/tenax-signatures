// Builds dist/: launchevent.js (single IIFE bundle for the classic Outlook JS-only runtime),
// launchevent.html and public/* (icons). The manifest template is rendered by the server, not here.
import { build } from "esbuild";
import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const entries = [
  ["src/launchevent.ts", "launchevent.js"],
  ["src/taskpane.ts", "taskpane.js"],
];
for (const [entry, out] of entries) await build({
  entryPoints: [join(root, entry)],
  outfile: join(dist, out),
  bundle: true,
  format: "iife", // no ES module syntax at runtime (brief 7.2)
  splitting: false, // dynamic imports get inlined into the single file
  platform: "browser",
  target: "es2017",
  minify: true,
  sourcemap: false,
  legalComments: "eof",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});

// Guard: the classic JS runtime can't load modules, so fail the build if any import survived.
const out = await readFile(join(dist, "launchevent.js"), "utf8");
for (const name of ["launchevent.js", "taskpane.js"]) {
  const code = await readFile(join(dist, name), "utf8");
  if (/(^|[^.\w$])import\s*\(|^\s*import[\s{*]|^\s*export\s/m.test(code)) {
    console.error(`${name} still contains ES import/export syntax; the classic Outlook runtime can't load it.`);
    process.exit(1);
  }
}

await copyFile(join(root, "src/launchevent.html"), join(dist, "launchevent.html"));
await copyFile(join(root, "src/taskpane.html"), join(dist, "taskpane.html"));

const publicDir = join(root, "public");
for (const name of await readdir(publicDir)) {
  if (name.startsWith(".")) continue;
  await copyFile(join(publicDir, name), join(dist, name));
}

console.log(`dist ready: launchevent.js (${(out.length / 1024).toFixed(1)} KiB), launchevent.html, icons`);
