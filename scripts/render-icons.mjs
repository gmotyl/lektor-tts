// Renders every extension icon and the store logo from the single SVG source
// (icons/icon.svg). Run with `pnpm icons`; the PNGs are committed.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const TARGETS = [
  { size: 16, file: "icons/icon16.png" },
  { size: 48, file: "icons/icon48.png" },
  { size: 128, file: "icons/icon128.png" },
  { size: 300, file: "store/logo-300.png" },
];

export function renderIcons({ svgPath = join(root, "icons", "icon.svg"), outDir = root } = {}) {
  const svg = readFileSync(svgPath);
  return TARGETS.map(({ size, file }) => {
    const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
    const out = join(outDir, file);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, png);
    return out;
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const out of renderIcons()) console.log(`wrote ${out}`);
}
