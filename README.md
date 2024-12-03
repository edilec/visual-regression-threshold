# Visual Regression Threshold

`visual-regression-threshold` compares two local screenshot *pixel exports* and returns a deterministic failure summary and an inline diff image. It does not capture pages, decode PNG files, call a browser, or write images to disk. Node.js 22+; zero dependencies.

## Quick start

```sh
node bin/visual-regression-threshold.mjs --root examples --input passing.json
node bin/visual-regression-threshold.mjs --root examples --input failing.json
npm run check
```

The passing example exits `0`: a timestamp-area pixel changed under an explicit mask. The failing example exits `1`: a second pixel outside that mask changed. Invalid CLI configuration exits `2` with empty stdout; unreadable or unusable evidence exits `2` with an `incomplete` JSON report. Stdout otherwise holds exactly one JSON report. Input realpaths must stay inside the real `--root`.

## Export format

```json
{
  "schemaVersion": "1",
  "complete": true,
  "baseline": { "width": 2, "height": 1, "pixels": ["#ffffffff", "#ffffffff"] },
  "current": { "width": 2, "height": 1, "pixels": ["#000000ff", "#ffffffff"] },
  "policy": { "masks": [{ "x": 0, "y": 0, "width": 1, "height": 1 }], "pixelThreshold": 0, "maxChangedPixels": 0, "maxMeanLumaDelta": 0 }
}
```

Pixels are row-major `#RRGGBBAA` strings. Baseline and current dimensions must match. Each mask is an in-bounds rectangle in pixel coordinates; overlapping masks count a pixel once. A wholly masked comparison is incomplete, not a vacuous pass. Before comparison, RGBA is composited over white, so transparent hidden RGB does not cause a visible difference. An unmasked pixel changes when its maximum displayed RGB channel difference is strictly greater than `pixelThreshold`. A report fails when the changed-pixel count exceeds `maxChangedPixels`, or mean absolute displayed luma difference exceeds `maxMeanLumaDelta`. Luma uses fixed Rec. 709 coefficients as a lightweight perceptual proxy, not a full perceptual metric. The optional top-level string `note` is ignored.

## Report and rules

The v1 report records `dimensions`, `metrics` (compared/masked/changed pixels, unrounded mean luma delta, configured thresholds), sorted `findings`, and `diffImage`. The reported luma value is exactly the value compared with its threshold, including tiny nonzero differences. `diffImage` is a base64-encoded portable graymap (`P2` PGM): `0` unchanged, `1` masked, `2` changed. It is bounded by the pixel cap and remains inside stdout; no output path is accepted. Findings use logical source role `@export`, referring to the exact input file, and a JSON pointer. No pixel values or source paths are echoed. Findings sort by UTF-16 code-unit `(location.file, location.pointer, ruleId)`.

| Rule | Severity | Status / exit |
| --- | --- | --- |
| `pixel-budget-exceeded`, `luma-budget-exceeded` | error | fail / `1` |
| `input-unreadable`, `input-invalid`, `duplicate-key`, `byte-limit`, `pixel-limit`, `mask-limit`, `depth-limit`, `time-limit`, `export-incomplete`, `raster-invalid`, `dimension-mismatch`, `policy-invalid`, `no-comparison` | error | incomplete / `2` |

## Limits and non-goals

Strict UTF-8; at most 1,048,576 bytes, width/height 1–64, 4,096 pixels per raster, 20 masks, JSON depth 4 (root 0), and 5,000 ms injected processing time. Thresholds: `pixelThreshold` 0–255, `maxChangedPixels` 0–4,096, `maxMeanLumaDelta` 0–255. Exact N and N+1 cases are tested for upper bounds. Duplicate JSON keys, including escaped spellings, and unknown fields are refused.

This compares supplied pixels only. It does not establish that the exports came from equivalent devices, viewports, fonts, capture timing, or color profiles; those conditions belong to the fixture producer. It makes no network calls or external writes.
