import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compareRasters, LIMITS, parseStrictJson } from '../src/index.mjs';

const W = '#ffffffff', B = '#000000ff';
const raster = (width, height, pixels) => ({ width, height, pixels });
const doc = (before = [W, W, W, W, W, W, W, W], after = before, masks = [], policy = {}) => ({ schemaVersion: '1', complete: true, baseline: raster(4, 2, [...before]), current: raster(4, 2, [...after]), policy: { masks, pixelThreshold: 0, maxChangedPixels: 0, maxMeanLumaDelta: 0, ...policy } });
const run = (root, input) => spawnSync(process.execPath, ['bin/visual-regression-threshold.mjs', '--root', root, '--input', input], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--import=/Users/km/Desktop/web/open-source/migration-plan-template/support/deny-network.mjs' } });

test('good identical screenshot exports pass and include bounded diff image', () => {
  const r = compareRasters(doc()); assert.equal(r.status, 'pass'); assert.equal(r.dimensions.width, 4); assert.equal(r.metrics.changedPixels, 0);
  assert.equal(r.diffImage.mimeType, 'image/x-portable-graymap'); assert.ok(Buffer.from(r.diffImage.base64, 'base64').toString().startsWith('P2\n4 2\n2\n'));
});
test('ignored timestamp pixel passes but moved button outside mask fails', () => {
  const changed = [B, W, W, W, W, B, W, W]; const mask = [{ x: 0, y: 0, width: 1, height: 1 }];
  const r = compareRasters(doc(undefined, changed, mask)); assert.equal(r.status, 'fail'); assert.equal(r.metrics.changedPixels, 1); assert.equal(r.findings[0].ruleId, 'pixel-budget-exceeded');
  const onlyTime = [...changed]; onlyTime[5] = W; const safe = compareRasters(doc(undefined, onlyTime, mask)); assert.equal(safe.status, 'pass'); assert.equal(safe.metrics.maskedPixels, 1);
});
test('pixel and mean luma thresholds, comparison dimensions are recorded', () => {
  const changed = [B, W, W, W, W, W, W, W];
  assert.equal(compareRasters(doc(undefined, changed, [], { maxChangedPixels: 1, maxMeanLumaDelta: 255 })).status, 'pass');
  assert.equal(compareRasters(doc(undefined, changed, [], { pixelThreshold: 255, maxMeanLumaDelta: 255 })).status, 'pass');
  const luma = compareRasters(doc(undefined, changed, [], { maxChangedPixels: 1, maxMeanLumaDelta: 0 })); assert.equal(luma.status, 'fail'); assert.ok(luma.findings.some(f => f.ruleId === 'luma-budget-exceeded'));
  assert.deepEqual(luma.dimensions, { width: 4, height: 2 });
});
test('dimension mismatch, partial evidence and invalid mask never pass', () => {
  const mismatch = doc(); mismatch.current.width = 2; assert.equal(compareRasters(mismatch).status, 'incomplete');
  assert.equal(compareRasters({ ...doc(), complete: false }).status, 'incomplete');
  assert.equal(compareRasters(doc(undefined, undefined, [{ x: 4, y: 0, width: 1, height: 1 }])).status, 'incomplete');
  const short = doc(); short.current.pixels.pop(); assert.equal(compareRasters(short).status, 'incomplete');
});
test('fully masked raster is incomplete rather than vacuously passing', () => {
  const r = compareRasters(doc(undefined, undefined, [{ x: 0, y: 0, width: 4, height: 2 }]));
  assert.equal(r.status, 'incomplete'); assert.equal(r.findings[0].ruleId, 'no-comparison');
});
test('fully transparent RGB differences are not visible changes', () => {
  const before = ['#00000000', ...Array(7).fill(W)];
  const after = ['#ff000000', ...Array(7).fill(W)];
  assert.equal(compareRasters(doc(before, after)).status, 'pass');
});
test('reported luma metric exposes the value that breached a zero threshold', () => {
  const x = { ...doc(), baseline: raster(1, 1, [W]), current: raster(1, 1, ['#fffffe01']), policy: { masks: [], pixelThreshold: 0, maxChangedPixels: 1, maxMeanLumaDelta: 0 } };
  const r = compareRasters(x); assert.equal(r.status, 'fail'); assert.equal(r.findings[0].ruleId, 'luma-budget-exceeded'); assert.ok(r.metrics.meanLumaDelta > 0);
});
test('pixel, mask, byte, depth and time limits enforce N and N+1', () => {
  const pixels = Array(LIMITS.pixels).fill(W); const max = { ...doc(), baseline: raster(64, 64, pixels), current: raster(64, 64, pixels) };
  assert.equal(compareRasters(max).status, 'pass');
  assert.equal(compareRasters({ ...max, baseline: raster(65, 64, Array(65 * 64).fill(W)), current: raster(65, 64, Array(65 * 64).fill(W)) }).findings[0].ruleId, 'pixel-limit');
  assert.equal(compareRasters({ ...max, baseline: raster(64, 65, Array(64 * 65).fill(W)), current: raster(64, 65, Array(64 * 65).fill(W)) }).findings[0].ruleId, 'pixel-limit');
  assert.equal(compareRasters({ ...max, policy: { ...max.policy, pixelThreshold: 255, maxChangedPixels: LIMITS.pixels, maxMeanLumaDelta: 255 } }).status, 'pass');
  assert.equal(compareRasters({ ...max, policy: { ...max.policy, pixelThreshold: 256 } }).status, 'incomplete');
  assert.equal(compareRasters({ ...max, policy: { ...max.policy, maxChangedPixels: LIMITS.pixels + 1 } }).status, 'incomplete');
  assert.equal(compareRasters({ ...max, policy: { ...max.policy, maxMeanLumaDelta: 256 } }).status, 'incomplete');
  const masks = Array.from({ length: LIMITS.masks }, (_, i) => ({ x: i, y: 0, width: 1, height: 1 })); assert.equal(compareRasters({ ...max, policy: { ...max.policy, masks } }).status, 'pass'); assert.equal(compareRasters({ ...max, policy: { ...max.policy, masks: masks.concat(masks[0]) } }).findings[0].ruleId, 'mask-limit');
  const x = doc(); x.note = ''; const overhead = Buffer.byteLength(JSON.stringify(x)); x.note = 'x'.repeat(LIMITS.bytes - overhead); assert.equal(compareRasters(x).status, 'pass'); x.note += 'x'; assert.equal(compareRasters(x).findings[0].ruleId, 'byte-limit');
  const deep = doc(); assert.equal(compareRasters(deep).status, 'pass'); deep.policy.masks = [{ x: 0, y: 0, width: { nested: 1 }, height: 1 }]; assert.equal(compareRasters(deep).findings[0].ruleId, 'depth-limit');
  assert.equal(compareRasters(doc(), { now: (() => { let n=0; return () => n++ ? LIMITS.milliseconds : 0; })() }).status, 'pass'); assert.equal(compareRasters(doc(), { now: (() => { let n=0; return () => n++ ? LIMITS.milliseconds + 1 : 0; })() }).findings[0].ruleId, 'time-limit');
});
test('duplicate JSON keys including escaped spelling are refused', () => assert.throws(() => parseStrictJson('{"complete":false,"complet\\u0065":true}'), /duplicate-key/));
test('CLI strict UTF-8, read confinement, invalid root and usage shapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'raster-')); await writeFile(join(root, 'good.json'), JSON.stringify(doc())); assert.equal(run(root, 'good.json').status, 0);
  await writeFile(join(root, 'bad.json'), Buffer.from([0xff])); assert.equal(JSON.parse(run(root, 'bad.json').stdout).status, 'incomplete');
  await symlink(tmpdir(), join(root, 'escape')); assert.equal(JSON.parse(run(root, 'escape/no.json').stdout).status, 'incomplete');
  assert.equal(run(join(root, 'missing-root'), 'good.json').stdout, '');
  const usage = spawnSync(process.execPath, ['bin/visual-regression-threshold.mjs', '--root', root, '--input', 'good.json', '--bad'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }); assert.equal(usage.status, 2); assert.equal(usage.stdout, '');
});
