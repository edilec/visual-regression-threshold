export const TOOL_ID = 'visual-regression-threshold';
export const LIMITS = Object.freeze({ bytes: 1_048_576, width: 64, height: 64, pixels: 4096, masks: 20, depth: 4, milliseconds: 5000 });
export const RULE_SEVERITY = Object.freeze({
  'input-unreadable': 'error', 'input-invalid': 'error', 'duplicate-key': 'error', 'byte-limit': 'error', 'pixel-limit': 'error', 'mask-limit': 'error', 'depth-limit': 'error', 'time-limit': 'error', 'export-incomplete': 'error', 'raster-invalid': 'error', 'dimension-mismatch': 'error', 'policy-invalid': 'error', 'no-comparison': 'error',
  'pixel-budget-exceeded': 'error', 'luma-budget-exceeded': 'error'
});
const UNKNOWN = new Set(['input-unreadable', 'input-invalid', 'duplicate-key', 'byte-limit', 'pixel-limit', 'mask-limit', 'depth-limit', 'time-limit', 'export-incomplete', 'raster-invalid', 'dimension-mismatch', 'policy-invalid', 'no-comparison']);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function finding(ruleId, pointer = '') {
  if (!Object.hasOwn(RULE_SEVERITY, ruleId)) throw new Error('Unknown rule');
  return { ruleId, severity: RULE_SEVERITY[ruleId], message: {
    'pixel-budget-exceeded': 'Changed pixels exceed the configured budget.',
    'luma-budget-exceeded': 'Mean luma difference exceeds the configured budget.',
    'dimension-mismatch': 'Baseline and current raster dimensions differ.'
  }[ruleId] ?? 'Raster comparison evidence cannot be evaluated safely.', location: { file: '@export', pointer } };
}
function report(findings, metrics = null, dimensions = null, diffImage = null) {
  findings.sort((a, b) => order(a.location.file, b.location.file) || order(a.location.pointer, b.location.pointer) || order(a.ruleId, b.ruleId));
  return { schemaVersion: '1', tool: TOOL_ID, status: findings.some(f => UNKNOWN.has(f.ruleId)) ? 'incomplete' : findings.length ? 'fail' : 'pass', summary: { checked: metrics?.comparedPixels ?? 0, errors: findings.length, warnings: 0 }, dimensions, metrics, diffImage, findings };
}
export const incomplete = ruleId => report([finding(ruleId)]);
export function parseStrictJson(raw) {
  const value = JSON.parse(raw); let i = 0;
  const space = () => { while (/\s/u.test(raw[i] ?? '')) i++; };
  const token = () => { const start = i++; while (i < raw.length) { if (raw[i] === '\\') { i += 2; continue; } if (raw[i++] === '"') return JSON.parse(raw.slice(start, i)); } throw new Error('input-invalid'); };
  const walk = depth => { if (depth > LIMITS.depth) throw new Error('depth-limit'); space(); if (raw[i] === '{') { i++; space(); const keys = new Set(); while (raw[i] !== '}') { const key = token(); if (keys.has(key)) throw new Error('duplicate-key'); keys.add(key); space(); i++; walk(depth + 1); space(); if (raw[i] !== ',') break; i++; space(); } i++; return; } if (raw[i] === '[') { i++; space(); while (raw[i] !== ']') { walk(depth + 1); space(); if (raw[i] !== ',') break; i++; space(); } i++; return; } if (raw[i] === '"') { token(); return; } while (i < raw.length && !/[\s,}\]]/u.test(raw[i])) i++; };
  walk(0); return value;
}
function tooDeep(v, depth = 0) { return depth > LIMITS.depth || (v !== null && typeof v === 'object' && Object.values(v).some(child => tooDeep(child, depth + 1))); }
function rasterShape(raster) {
  return object(raster) && Number.isSafeInteger(raster.width) && raster.width >= 1 && Number.isSafeInteger(raster.height) && raster.height >= 1 && Array.isArray(raster.pixels) && Object.keys(raster).every(k => ['width', 'height', 'pixels'].includes(k));
}
function channels(pixel) {
  return [1, 3, 5, 7].map(i => Number.parseInt(pixel.slice(i, i + 2), 16));
}
function displayed(rgba) {
  const alpha = rgba[3] / 255;
  return [0, 1, 2].map(i => rgba[i] * alpha + 255 * (1 - alpha));
}
const luma = rgb => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
export function compareRasters(document, { now = Date.now } = {}) {
  const start = now(), expired = () => now() - start > LIMITS.milliseconds;
  if (!object(document)) return incomplete('input-invalid');
  let bytes; try { bytes = Buffer.byteLength(JSON.stringify(document)); } catch { return incomplete('input-invalid'); }
  if (bytes > LIMITS.bytes) return incomplete('byte-limit');
  if (tooDeep(document)) return incomplete('depth-limit');
  if (expired()) return incomplete('time-limit');
  if (document.schemaVersion !== '1' || !rasterShape(document.baseline) || !rasterShape(document.current) || !object(document.policy) || Object.keys(document).some(k => !['schemaVersion', 'complete', 'baseline', 'current', 'policy', 'note'].includes(k)) || (document.note !== undefined && typeof document.note !== 'string')) return incomplete('input-invalid');
  if (document.complete !== true) return incomplete('export-incomplete');
  const before = document.baseline, after = document.current, policy = document.policy;
  if (before.width > LIMITS.width || after.width > LIMITS.width || before.height > LIMITS.height || after.height > LIMITS.height || before.width * before.height > LIMITS.pixels || after.width * after.height > LIMITS.pixels) return incomplete('pixel-limit');
  if (before.width !== after.width || before.height !== after.height) return report([finding('dimension-mismatch')]);
  const total = before.width * before.height;
  if (before.pixels.length !== total || after.pixels.length !== total || before.pixels.some(p => typeof p !== 'string' || !/^#[0-9a-fA-F]{8}$/u.test(p)) || after.pixels.some(p => typeof p !== 'string' || !/^#[0-9a-fA-F]{8}$/u.test(p))) return incomplete('raster-invalid');
  if (!Array.isArray(policy.masks) || !Number.isSafeInteger(policy.pixelThreshold) || policy.pixelThreshold < 0 || policy.pixelThreshold > 255 || !Number.isSafeInteger(policy.maxChangedPixels) || policy.maxChangedPixels < 0 || policy.maxChangedPixels > LIMITS.pixels || typeof policy.maxMeanLumaDelta !== 'number' || !Number.isFinite(policy.maxMeanLumaDelta) || policy.maxMeanLumaDelta < 0 || policy.maxMeanLumaDelta > 255 || Object.keys(policy).some(k => !['masks', 'pixelThreshold', 'maxChangedPixels', 'maxMeanLumaDelta'].includes(k))) return incomplete('policy-invalid');
  if (policy.masks.length > LIMITS.masks) return incomplete('mask-limit');
  for (const mask of policy.masks) if (!object(mask) || !['x', 'y', 'width', 'height'].every(k => Number.isSafeInteger(mask[k])) || mask.x < 0 || mask.y < 0 || mask.width < 1 || mask.height < 1 || mask.x + mask.width > before.width || mask.y + mask.height > before.height || Object.keys(mask).some(k => !['x', 'y', 'width', 'height'].includes(k))) return incomplete('policy-invalid');
  const image = [], masked = new Uint8Array(total);
  for (const mask of policy.masks) for (let y = mask.y; y < mask.y + mask.height; y++) for (let x = mask.x; x < mask.x + mask.width; x++) masked[y * before.width + x] = 1;
  let changedPixels = 0, maskedPixels = 0, comparedPixels = 0, lumaSum = 0;
  for (let y = 0; y < before.height; y++) {
    if (expired()) return incomplete('time-limit');
    const row = [];
    for (let x = 0; x < before.width; x++) {
      const i = y * before.width + x;
      if (masked[i]) { maskedPixels++; row.push('1'); continue; }
      const a = displayed(channels(before.pixels[i])), b = displayed(channels(after.pixels[i]));
      const maxDelta = Math.max(...a.map((v, j) => Math.abs(v - b[j])));
      const changed = maxDelta > policy.pixelThreshold;
      comparedPixels++; if (changed) changedPixels++;
      lumaSum += Math.abs(luma(a) - luma(b));
      row.push(changed ? '2' : '0');
    }
    image.push(row.join(' '));
  }
  if (!comparedPixels) return incomplete('no-comparison');
  const mean = lumaSum / comparedPixels;
  const metrics = { comparedPixels, maskedPixels, changedPixels, meanLumaDelta: Math.round(mean * 1000) / 1000, pixelThreshold: policy.pixelThreshold, maxChangedPixels: policy.maxChangedPixels, maxMeanLumaDelta: policy.maxMeanLumaDelta };
  const dimensions = { width: before.width, height: before.height };
  const diffImage = { mimeType: 'image/x-portable-graymap', base64: Buffer.from(`P2\n${before.width} ${before.height}\n2\n${image.join('\n')}\n`, 'ascii').toString('base64') };
  const findings = [];
  if (changedPixels > policy.maxChangedPixels) findings.push(finding('pixel-budget-exceeded', '/policy/maxChangedPixels'));
  if (mean > policy.maxMeanLumaDelta) findings.push(finding('luma-budget-exceeded', '/policy/maxMeanLumaDelta'));
  if (expired()) return incomplete('time-limit');
  return report(findings, metrics, dimensions, diffImage);
}
