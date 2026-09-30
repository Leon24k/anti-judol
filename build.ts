/**
 * Build script (Bun). Bun is only a dev-time tool here: it bundles TypeScript
 * into plain browser JS. The extension itself runs in Chrome/Edge with no Bun runtime.
 *
 * - Content script → IIFE (MV3 content scripts are classic scripts, not modules).
 * - Service worker / popup / options → ESM.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { watch } from "node:fs";

const OUT = "dist";
const isWatch = process.argv.includes("--watch");

async function build(): Promise<void> {
  const t0 = performance.now();
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const common = {
    target: "browser" as const,
    minify: !isWatch,
    sourcemap: isWatch ? ("inline" as const) : ("none" as const),
    define: { __DEV__: JSON.stringify(isWatch) },
  };

  const results = await Promise.all([
    Bun.build({ ...common, entrypoints: ["src/content/index.ts"], outdir: OUT, naming: "content.js", format: "iife" }),
    Bun.build({ ...common, entrypoints: ["src/background/index.ts"], outdir: OUT, naming: "background.js", format: "esm" }),
    Bun.build({ ...common, entrypoints: ["src/popup/popup.ts"], outdir: OUT, naming: "popup.js", format: "esm" }),
    Bun.build({ ...common, entrypoints: ["src/options/options.ts"], outdir: OUT, naming: "options.js", format: "esm" }),
  ]);

  for (const r of results) {
    if (!r.success) {
      for (const log of r.logs) console.error(log);
      throw new Error("Build failed");
    }
  }

  await cp("static", OUT, { recursive: true });
  console.log(`built ${OUT}/ in ${(performance.now() - t0).toFixed(0)}ms`);
}

await build();

if (isWatch) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((e) => console.error(e)), 80);
  };
  watch("src", { recursive: true }, rebuild);
  watch("static", { recursive: true }, rebuild);
  console.log("watching src/ and static/ …");
}
