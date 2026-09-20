import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeGrade, isNeutral, DEFAULT_GRADE, GRADE_PRESETS, GRADE_FIELDS } from '../src/grading.js';
test('picture settings are clamped, presets stay in range, defaults are neutral', () => {
  assert.ok(isNeutral(sanitizeGrade()));
  const g = sanitizeGrade({ brightness: 9, contrast: -3, saturation: 'x', gamma: 1.2 });
  assert.equal(g.brightness, 0.25);
  assert.equal(g.contrast, 0.6);
  assert.equal(g.saturation, DEFAULT_GRADE.saturation);
  assert.equal(g.gamma, 1.2);
  assert.ok(!isNeutral(g));
  for (const p of Object.values(GRADE_PRESETS)) {
    const s = sanitizeGrade({ ...DEFAULT_GRADE, ...p });
    for (const [key] of GRADE_FIELDS) assert.equal(s[key], p[key] ?? DEFAULT_GRADE[key], key);
  }
});
import { startingGrade } from '../src/grading.js';
test('new players start with the Cinematic look', () => {
  const g = startingGrade();
  assert.equal(g.contrast, GRADE_PRESETS.cinematic.contrast);
  assert.equal(g.vignette, GRADE_PRESETS.cinematic.vignette);
  assert.ok(!isNeutral(g));
});
