import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'device-annotate-package-'));
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 180_000,
    env: { ...process.env, NODE_PATH: '', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' } });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.error ?? ''}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temporary]))[0];
  const files = packed.files.map((file) => file.path);
  const required = ['package.json', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'bin/device-annotate.mjs',
    'dist/index.js', 'dist/index.d.ts', 'src/cli/help.md', 'src/spec/spec.schema.json',
    'src/render/fonts/Inter-Regular.ttf', 'src/render/fonts/LICENSE.txt',
    'src/vendor/agent-device/LICENSE', 'src/vendor/agent-device/sources.json'];
  for (const file of required) assert.ok(files.includes(file), `Missing ${file}`);
  for (const file of files) assert.match(file, /^(?:dist\/.*\.(?:js|d\.ts)|bin\/device-annotate\.mjs|src\/cli\/help\.md|src\/(?:spec|manifest)\/[^/]+\.schema\.json|src\/render\/fonts\/(?:Inter-Regular\.ttf|LICENSE\.txt|README\.md)|src\/vendor\/agent-device\/(?:LICENSE|README\.md|sources\.json)|package\.json|LICENSE|README\.md|THIRD_PARTY_NOTICES\.md)$/, `Unexpected packed file: ${file}`);
  const consumer = join(temporary, 'consumer');
  await cp(new URL('../test/package/', import.meta.url), consumer, { recursive: true });
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, packed.filename)], consumer);
  await cp(new URL('../test/fixtures/capture-spike/ios/', import.meta.url), join(consumer, 'fixture'), { recursive: true });
  await cp(new URL('../examples/environment.complete.json', import.meta.url), join(consumer, 'environment.json'));
  textOutput(run(process.execPath, ['consumer.mjs'], consumer));
  const manifest = JSON.parse(await readFile(join(consumer, 'node_modules/device-annotate/package.json')));
  assert.equal(manifest.peerDependencies['agent-device'], '0.21.27');
  console.log(JSON.stringify({ package: packed.filename, files: files.length, bytes: packed.size, integrity: packed.integrity, consumer: 'passed' }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
function textOutput(value) { process.stdout.write(value); }
