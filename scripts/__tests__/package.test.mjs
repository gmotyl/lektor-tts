// Store package checks: zip contents and the manifest/package.json version guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { unzipSync } from "fflate";
import { packageExtension } from "../package.mjs";

// Writes a fake extension tree (runtime files plus every non-runtime decoy) into a temp dir.
function fakeRoot({ manifestVersion = "1.0.0", packageVersion = "1.0.0" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "lektor-package-"));
  const put = (rel, body = "x") => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  put("manifest.json", JSON.stringify({ manifest_version: 3, name: "Lektor TTS", version: manifestVersion }));
  put("package.json", JSON.stringify({ name: "lektor-tts", version: packageVersion }));
  put("src/background.mjs");
  put("src/options.html");
  put("src/content/main.mjs");
  put("src/__tests__/background.test.mjs");
  put("src/content/__tests__/main.test.mjs");
  put("icons/icon16.png");
  put("icons/icon128.png");
  put("icons/icon.svg");
  put("node_modules/fflate/index.js");
  put("scripts/package.mjs");
  put("store/listing.md");
  put("qa/visual/setup-390.png");
  put("openspec/specs/x.md");
  put("README.md");
  put("build.mjs");
  return root;
}

// Stands in for `node build.mjs`: writes the bundle the real build would produce.
const fakeBuild = (root) => {
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", "content.js"), "bundle");
};

test("package zip holds only runtime files", async () => {
  const root = fakeRoot();
  try {
    const { zipPath } = await packageExtension({ root, build: fakeBuild });
    assert.equal(zipPath, join(root, "lektor-tts-1.0.0.zip"));
    const names = Object.keys(unzipSync(readFileSync(zipPath))).sort();
    assert.deepEqual(names, [
      "dist/content.js",
      "icons/icon128.png",
      "icons/icon16.png",
      "manifest.json",
      "src/background.mjs",
      "src/content/main.mjs",
      "src/options.html",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("package refuses mismatched versions", async () => {
  const root = fakeRoot({ manifestVersion: "1.0.1", packageVersion: "1.0.0" });
  let built = false;
  try {
    await assert.rejects(
      packageExtension({ root, build: () => (built = true) }),
      /version/i,
    );
    assert.equal(built, false);
    assert.deepEqual(
      readdirSync(root).filter((name) => name.endsWith(".zip")),
      [],
    );
    assert.equal(existsSync(join(root, "lektor-tts-1.0.0.zip")), false);
    assert.equal(existsSync(join(root, "lektor-tts-1.0.1.zip")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("package deletes a stale zip before building, so a failed build leaves none", async () => {
  const root = fakeRoot();
  const zipPath = join(root, "lektor-tts-1.0.0.zip");
  writeFileSync(zipPath, "stale");
  try {
    await assert.rejects(
      packageExtension({
        root,
        build: () => {
          throw new Error("build failed");
        },
      }),
      /build failed/,
    );
    assert.equal(existsSync(zipPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("package clears dist before building, so leftover files are not packed", async () => {
  const root = fakeRoot();
  mkdirSync(join(root, "dist", "old"), { recursive: true });
  writeFileSync(join(root, "dist", "stale.js"), "old");
  writeFileSync(join(root, "dist", "old", "chunk.js"), "old");
  try {
    let distAtBuild = null;
    const { zipPath } = await packageExtension({
      root,
      build: (r) => {
        distAtBuild = existsSync(join(r, "dist")) ? readdirSync(join(r, "dist")) : [];
        fakeBuild(r);
      },
    });
    assert.deepEqual(distAtBuild, []);
    const names = Object.keys(unzipSync(readFileSync(zipPath)));
    assert.deepEqual(names.filter((name) => name.startsWith("dist/")), ["dist/content.js"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
