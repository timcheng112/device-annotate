import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { cases, setup, loadCase } from './helpers.mjs';
const renderer = await setup();
for (const name of cases) test(`reviewed ${name} pixels match`, async () => {
  const result = renderer.render(await loadCase(name));
  assert.equal(result.kind, 'rendered');
  const actual = PNG.sync.read(Buffer.from(result.png));
  const expected = PNG.sync.read(await readFile(new URL(`approved/${name}.png`, import.meta.url)));
  assert.equal(actual.width, expected.width); assert.equal(actual.height, expected.height);
  assert.ok(actual.data.equals(expected.data), `${name}: pixel mismatch; generate candidates and review before replacing references.`);
});
