import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('src/vendor/agent-device/sources.json', root), 'utf8'));
for (const file of manifest.files) {
  const content = await readFile(new URL(file.path, root));
  if (createHash('sha256').update(content).digest('hex') !== file.sha256) throw new Error(`Vendored file changed: ${file.path}. Review against pinned upstream and regenerate.`);
}
console.log(`Verified ${manifest.files.length} vendor source/license/test hashes for agent-device ${manifest.version}.`);
