import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(here, "dist");
  await rm(distDir, { recursive: true, force: true });
  await esbuild({
    entryPoints: [path.resolve(here, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    sourcemap: "linked",
    logLevel: "info",
    banner: {
      js: `import { createRequire as __cr } from 'node:module';
import __p from 'node:path';
import __u from 'node:url';
globalThis.require = __cr(import.meta.url);
globalThis.__filename = __u.fileURLToPath(import.meta.url);
globalThis.__dirname = __p.dirname(globalThis.__filename);`,
    },
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
