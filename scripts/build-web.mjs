#!/usr/bin/env node
// Build the dsh-per web client bundle in the lazy-CJS loader format:
//   window.__ModuleLoader__.load({ id, factory(require) { ...; return module.exports } })
// The source (web/src/client.js) is written directly in CommonJS factory-body
// style — `require('react')` stays a runtime require against the shell-seeded
// react module, so no bundler or transform is needed (zero external deps).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'web', 'src', 'client.js');
const outDir = join(root, 'web', 'dist');
const out = join(outDir, 'client.js');

const body = readFileSync(src, 'utf8');
const banner = `window.__ModuleLoader__.load({
\tid: "dsh-per",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
`;
const foot = `\t\treturn module.exports;
\t}
});
//# sourceMappingURL=dsh-per-web-client\n`;

mkdirSync(outDir, { recursive: true });
writeFileSync(out, banner + body + foot, 'utf8');
process.stdout.write(`dsh-per web bundle -> ${out} (${Buffer.byteLength(banner + body + foot)} bytes)\n`);
