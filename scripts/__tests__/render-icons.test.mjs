// Icon checks: the single SVG source (icons/icon.svg) and the PNGs rendered from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const svgPath = join(root, "icons", "icon.svg");
const readSvg = () => readFileSync(svgPath, "utf8");

const NAVY = [0x1e, 0x2a, 0x4a];

// Attributes of every <tag ...> element in the SVG text.
function elements(svg, tag) {
  return [...svg.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))].map(([, attrs]) =>
    Object.fromEntries([...attrs.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])),
  );
}

// Minimal PNG decoder: 8-bit RGBA, non-interlaced (what resvg writes).
function decodePng(buf) {
  assert.equal(buf.toString("latin1", 1, 4), "PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "bit depth 8");
      assert.equal(data[9], 6, "colour type RGBA");
      assert.equal(data[12], 0, "non-interlaced");
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = (line[x] + pred) & 0xff;
    }
  }
  return { width, height, at: (x, y) => [...px.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)] };
}

const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

test("icon svg has a 128 viewBox", () => {
  const [svg] = elements(readSvg(), "svg");
  assert.equal(svg.viewBox, "0 0 128 128");
});

test("icon svg tile is navy rx 28 and fills the square", () => {
  const rects = elements(readSvg(), "rect");
  assert.equal(rects.length, 1);
  const [tile] = rects;
  assert.equal(tile.fill.toLowerCase(), "#1e2a4a");
  assert.equal(tile.rx, "28");
  assert.equal(Number(tile.x ?? 0), 0);
  assert.equal(Number(tile.y ?? 0), 0);
  assert.equal(tile.width, "128");
  assert.equal(tile.height, "128");
});

test("icon svg L is white stroke 18 with round caps on the left half", () => {
  const white = elements(readSvg(), "path").filter((p) => /^#fff(fff)?$/i.test(p.stroke ?? ""));
  assert.equal(white.length, 1);
  const [l] = white;
  assert.equal(l["stroke-width"], "18");
  assert.equal(l["stroke-linecap"], "round");
  assert.equal(l["stroke-linejoin"], "round");
  assert.equal(l.fill, "none");
  // "M x y V y2 H x2": a vertical stem going down, then a foot to the right.
  const m = l.d.match(/^M\s*([\d.]+)[ ,]+([\d.]+)\s*V\s*([\d.]+)\s*H\s*([\d.]+)$/);
  assert.ok(m, `L path shape: ${l.d}`);
  const [stemX, top, bottom, footX] = m.slice(1).map(Number);
  assert.ok(stemX + 9 < 64, "stem lies in the left half");
  assert.ok(bottom > top && footX > stemX, "stem down, foot to the right");
});

test("icon svg has two yellow stroke-8 arcs inside the tile", () => {
  const svg = readSvg();
  const [l] = elements(svg, "path").filter((p) => /^#fff(fff)?$/i.test(p.stroke ?? ""));
  const [, , cornerY] = l.d.match(/^M\s*([\d.]+)[ ,]+[\d.]+\s*V\s*([\d.]+)/).map(Number);
  const arcs = elements(svg, "path").filter((p) => (p.stroke ?? "").toLowerCase() === "#ffd54a");
  assert.equal(arcs.length, 2);
  const shapes = arcs.map((a) => {
    assert.equal(a["stroke-width"], "8");
    assert.equal(a.fill, "none");
    // "M x y a r r 0 0 1 dx dy": a relative arc, chord vertical.
    const m = a.d.match(/^M\s*([\d.]+)[ ,]+([\d.]+)\s*a\s*([\d.]+)[ ,]+([\d.]+)[ ,]+0[ ,]+0[ ,]+1[ ,]+([\d.-]+)[ ,]+([\d.-]+)$/);
    assert.ok(m, `arc path shape: ${a.d}`);
    const [x, y, r, , dx, dy] = m.slice(1).map(Number);
    assert.equal(dx, 0);
    const half = dy / 2;
    const cx = x - Math.sqrt(r * r - half * half); // sweep 1, small arc: centre left of the chord
    const cy = y + half;
    // Every point of the stroke stays inside the 128 square.
    assert.ok(cx + r + 4 <= 128 && y - 4 >= 0 && y + dy + 4 <= 128, `arc inside the tile: ${a.d}`);
    return { cx, cy, r };
  });
  const [inner, outer] = shapes.sort((p, q) => p.r - q.r);
  assert.ok(outer.r > inner.r);
  assert.ok(Math.hypot(outer.cx - inner.cx, outer.cy - inner.cy) < 3, "arcs are concentric");
  // Centred right of the stem and above the foot: they come out of the L's corner region.
  assert.ok(inner.cx > 38 && inner.cx < 76 && inner.cy < cornerY, "arcs start at the L's corner region");
});

test("render-icons writes 16 48 128 and 300 px PNGs from icon.svg", async () => {
  const { renderIcons, TARGETS } = await import("../render-icons.mjs");
  assert.deepEqual(
    TARGETS.map((t) => [t.size, t.file]),
    [
      [16, "icons/icon16.png"],
      [48, "icons/icon48.png"],
      [128, "icons/icon128.png"],
      [300, "store/logo-300.png"],
    ],
  );
  const out = mkdtempSync(join(tmpdir(), "lektor-icons-"));
  try {
    const written = renderIcons({ svgPath, outDir: out });
    assert.equal(written.length, 4);
    for (const { size, file } of TARGETS) {
      const path = join(out, file);
      assert.ok(existsSync(path), `missing ${file}`);
      assert.deepEqual(pngSize(readFileSync(path)), { width: size, height: size });
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
  // The script has no image input besides icon.svg.
  const src = readFileSync(join(root, "scripts", "render-icons.mjs"), "utf8");
  assert.deepEqual([...src.matchAll(/["'][^"']*\.(svg|png|jpe?g|webp|gif)["']/g)].map((m) => m[1]).filter((e) => e !== "png"), ["svg"]);
  // The committed PNGs have the expected sizes too.
  for (const { size, file } of TARGETS) {
    assert.deepEqual(pngSize(readFileSync(join(root, file))), { width: size, height: size }, file);
  }
});

test("16 px icon keeps the L and the outer arc distinguishable from the tile", () => {
  const png = decodePng(readFileSync(join(root, "icons", "icon16.png")));
  assert.equal(png.width, 16);
  const tile = png.at(8, 2); // above the arcs, right of the stem: plain tile
  assert.ok(Math.max(...tile.slice(0, 3).map((v, i) => Math.abs(v - NAVY[i]))) <= 8, `tile is navy: ${tile}`);
  // L stem (x 29..47 of 128 → px 3.6..5.9), mid-height.
  const [r, g, b] = png.at(4, 7);
  assert.ok(Math.min(r, g, b) >= 200, `L pixel is light: ${[r, g, b]}`);
  // Outer arc's right edge (x 92..100 of 128 → px 11.5..12.5) at its middle row.
  const yellowness = ([pr, pg, pb]) => pr - pb;
  const best = [png.at(11, 7), png.at(12, 7), png.at(11, 6), png.at(12, 6)].sort((p, q) => yellowness(q) - yellowness(p))[0];
  assert.ok(yellowness(best) >= 60 && best[1] - best[2] >= 30, `outer arc pixel is yellowish: ${best}`);
});
