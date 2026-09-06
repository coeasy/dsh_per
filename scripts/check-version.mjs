import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const expected = readFileSync(join(root, 'VERSION'), 'utf8').trim();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const fail = (message) => {
  console.error(`[version:check] ${message}`);
  process.exitCode = 1;
};

if (expected !== '0.1.0') {
  fail(`VERSION must remain 0.1.0, got ${expected}`);
}
if (pkg.version !== expected) {
  fail(`package.json version ${pkg.version} != VERSION ${expected}`);
}

const publicSurfaces = [
  'README.md',
  'CHANGELOG.md',
  '.github/workflows/release.yml',
  'docs/PROJECT_OVERVIEW_AND_REFACTOR_PLAN.md',
  'docs/VERSIONING.md',
];
const forbiddenReleaseVersions = ['0.2.0', '0.3.0', '0.4.0', '0.4.1', '1.0.0'];

for (const rel of publicSurfaces) {
  const path = join(root, rel);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  for (const forbidden of forbiddenReleaseVersions) {
    if (text.includes(forbidden)) {
      fail(`${rel} contains forbidden release version ${forbidden}; public release version is fixed at 0.1.0`);
    }
  }
}

if (!process.exitCode) {
  console.log(`[version:check] OK — all public release surfaces aligned to ${expected}`);
}
