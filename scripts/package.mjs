// Builds the store zip: lektor-tts-<version>.zip with runtime files only
// (manifest.json, dist/**, src/** without __tests__, icons/*.png).
import { readFileSync, readdirSync, writeFileSync, statSync, existsSync, rmSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { zipSync } from "fflate";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Runs the real build (esbuild content bundle) with the extension root as cwd.
function runBuild(root) {
  const result = spawnSync(process.execPath, ["build.mjs"], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`build failed (exit ${result.status})`);
}

// All files under dir, as root-relative POSIX paths.
function walk(root, dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(root, rel)).isDirectory() ? walk(root, rel) : [rel];
  });
}

// Root-relative paths of every file that belongs in the store zip.
export function runtimeFiles(root) {
  return [
    "manifest.json",
    ...walk(root, "dist"),
    ...walk(root, "src").filter((path) => !path.split("/").includes("__tests__")),
    ...walk(root, "icons").filter((path) => /^icons\/[^/]+\.png$/.test(path)),
  ].sort();
}

export async function packageExtension({ root = repoRoot, outDir = root, build = runBuild } = {}) {
  const readJson = (name) => JSON.parse(readFileSync(join(root, name), "utf8"));
  const manifestVersion = readJson("manifest.json").version;
  const packageVersion = readJson("package.json").version;
  if (manifestVersion !== packageVersion) {
    throw new Error(
      `version mismatch: manifest.json ${manifestVersion} != package.json ${packageVersion}`,
    );
  }
  const zipPath = join(outDir, `lektor-tts-${manifestVersion}.zip`);
  // A failed build must not leave an older zip under the same name, and leftover
  // dist files from earlier builds must not end up in the package.
  rmSync(zipPath, { force: true });
  rmSync(join(root, "dist"), { recursive: true, force: true });
  await build(root);
  const files = runtimeFiles(root);
  const entries = Object.fromEntries(files.map((path) => [path, readFileSync(join(root, path))]));
  writeFileSync(zipPath, zipSync(entries, { level: 9 }));
  return { zipPath, files };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const { zipPath, files } = await packageExtension();
    console.log(`wrote ${relative(process.cwd(), zipPath).split(sep).join("/")} (${files.length} files)`);
  } catch (error) {
    console.error(`package: ${error.message}`);
    process.exit(1);
  }
}
