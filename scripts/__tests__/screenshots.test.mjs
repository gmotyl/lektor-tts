// Capture plan of scripts/screenshots.mjs: pure data, checked without launching a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { barCaptures } from "../screenshots.mjs";

test("screenshot plan lists the six bar state captures and the tip capture", () => {
  const files = barCaptures().map((c) => c.file);
  assert.deepEqual(files.toSorted(), [
    "bar-playing-1280.png",
    "bar-playing-390.png",
    "bar-selection-1280.png",
    "bar-selection-390.png",
    "bar-settings-1280.png",
    "bar-settings-390.png",
    "bar-tip-390.png",
  ]);
  for (const capture of barCaptures()) {
    const expected = capture.width === 390 ? { width: 390, height: 844 } : { width: 1280, height: 800 };
    assert.deepEqual(capture.viewport, expected, capture.file);
  }
});
