import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fetchRemoteDictionary } from '../src/remoteDictionary.js';

const root = resolve(process.cwd());
const outputDir = join(root, 'public', 'data');
const outputFile = join(outputDir, 'master-dictionary.json');

const payload = await fetchRemoteDictionary();
const document = {
  mode: 'local-file',
  generatedAt: new Date().toISOString(),
  ...payload
};

await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

console.log(`Wrote ${outputFile}`);
