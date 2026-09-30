/**
 * Production build → validated manifest → anti-judol-<version>.zip (contents of dist/ at zip root),
 * ready for Chrome Web Store / Edge Add-ons upload.
 */
import { existsSync } from "node:fs";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const build = Bun.spawnSync(["bun", "run", "build.ts"], { stdout: "inherit", stderr: "inherit" });
if (build.exitCode !== 0) process.exit(1);

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const errors: string[] = [];

if (manifest.version !== pkg.version) errors.push(`manifest version ${manifest.version} ≠ package.json ${pkg.version}`);
for (const p of Object.values<string>(manifest.icons ?? {})) if (!existsSync(join("dist", p))) errors.push(`missing icon ${p}`);
if (!manifest.icons?.["128"]) errors.push("128px icon required by the store");
if ((manifest.description ?? "").length > 132) errors.push("description > 132 chars");
if (manifest.optional_host_permissions || manifest.host_permissions?.some((h: string) => h.includes("*://*/") || h === "<all_urls>"))
  errors.push("broad host permissions");

// No secrets or dev leftovers in shipped code.
async function* files(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else yield p;
  }
}
for await (const f of files("dist")) {
  if (!/\.(js|html|json|css)$/.test(f)) continue;
  const s = await readFile(f, "utf8");
  if (/apikey_[a-f0-9]{16,}|sk-or-v1-[a-f0-9]{16,}/i.test(s)) errors.push(`${f}: looks like an API key`);
  if (/sourceMappingURL=data:/.test(s)) errors.push(`${f}: inline sourcemap in release build`);
  if (/\beval\(|new Function\(/.test(s)) errors.push(`${f}: eval/new Function`);
}

if (errors.length) {
  console.error("✗ package check failed:\n  " + errors.join("\n  "));
  process.exit(1);
}

const out = `anti-judol-${manifest.version}.zip`;
await rm(out, { force: true });
const zip = Bun.spawnSync(["zip", "-r", "-X", "-q", `../${out}`, "."], { cwd: "dist", stdout: "inherit", stderr: "inherit" });
if (zip.exitCode !== 0) process.exit(1);
console.log(`✓ ${out} (${((await stat(out)).size / 1024).toFixed(1)} KB)`);
