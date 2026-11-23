/**
 * Generate THIRD_PARTY_NOTICES.md from the installed production dependency tree.
 *
 * The app is GPLv3 free software and includes permissively licensed third-party
 * packages. This script collects the package list, license declarations, and
 * license texts so the notices file can ship with the installer.
 *
 * Usage: node scripts/generate-third-party-notices.mjs
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(root, 'package-lock.json');
const outputPath = join(root, 'THIRD_PARTY_NOTICES.md');
const packageJsonPath = join(root, 'package.json');

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const rootPackage = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const packages = lock.packages ?? {};

const SKIP_KEYS = new Set(['']);

function mitLicense(copyright) {
  return [
    'MIT License',
    '',
    copyright,
    '',
    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'of this software and associated documentation files (the "Software"), to deal',
    'in the Software without restriction, including without limitation the rights',
    'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
    'copies of the Software, and to permit persons to whom the Software is',
    'furnished to do so, subject to the following conditions:',
    '',
    'The above copyright notice and this permission notice shall be included in all',
    'copies or substantial portions of the Software.',
    '',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
    'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
    'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
    'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
    'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
    'SOFTWARE.',
  ].join('\n');
}

// A few packages declare a license in package.json but do not ship a license
// file. Reproduce the applicable text so the notices remain complete.
const MANUAL_LICENSES = new Map([
  [
    'nostr-wasm@0.1.0',
    {
      licenseText: mitLicense('Copyright (c) fiatjaf'),
      noticeText: null,
    },
  ],
  [
    'type-fest@2.19.0',
    {
      licenseText: [
        'type-fest is licensed under MIT OR CC0-1.0.',
        'The MIT option is reproduced below.',
        '',
        mitLicense('Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)'),
      ].join('\n'),
      noticeText: null,
    },
  ],
]);

function readPackageJson(dir) {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function findFile(dir, pattern) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const match = entries
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  return match ? join(dir, match) : null;
}

function readText(path) {
  if (!path) return null;
  try {
    return readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trim();
  } catch {
    return null;
  }
}

function findLicense(dir) {
  const named = [
    'LICENSE',
    'LICENSE.md',
    'LICENSE.txt',
    'LICENCE',
    'LICENCE.md',
    'LICENCE.txt',
    'COPYING',
    'COPYING.md',
    'COPYING.txt',
  ];
  for (const candidate of named) {
    const path = join(dir, candidate);
    if (existsSync(path)) {
      return { path, text: readText(path) };
    }
  }

  const generic = findFile(dir, /^(licen[cs]e|copying)(\.(md|txt))?$/i);
  return generic ? { path: generic, text: readText(generic) } : null;
}

function findNotice(dir) {
  const path = findFile(dir, /^notice(\.(md|txt))?$/i);
  return path ? { path, text: readText(path) } : null;
}

const collected = new Map();

for (const [key, meta] of Object.entries(packages)) {
  if (SKIP_KEYS.has(key)) continue;
  if (!key.startsWith('node_modules/')) continue;
  if (meta.dev) continue;

  const dir = join(root, key);
  const pkg = readPackageJson(dir);
  const name = pkg?.name ?? meta.name ?? key.replace(/^node_modules\//, '');
  const version = pkg?.version ?? meta.version ?? '';
  const license = pkg?.license ?? meta.license ?? 'UNKNOWN';
  const id = `${name}@${version}`;
  const licenseFile = findLicense(dir);
  const noticeFile = findNotice(dir);
  const manual = MANUAL_LICENSES.get(id);

  if (!collected.has(id)) {
    collected.set(id, {
      name,
      version,
      license: typeof license === 'string' ? license : JSON.stringify(license),
      licenseText: licenseFile?.text ?? manual?.licenseText ?? null,
      licensePath: licenseFile?.path ?? null,
      noticeText: noticeFile?.text ?? manual?.noticeText ?? null,
      noticePath: noticeFile?.path ?? null,
    });
  }
}

const entries = [...collected.values()].sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);

const electronDir = join(root, 'node_modules', 'electron');
const electronLicense = readText(join(electronDir, 'LICENSE'))
  ?? readText(join(electronDir, 'dist', 'LICENSE'));

const licenseGroups = new Map();
const withoutText = [];

for (const entry of entries) {
  if (!entry.licenseText) {
    withoutText.push(entry);
    continue;
  }

  const normalized = entry.licenseText.trim();
  if (!licenseGroups.has(normalized)) {
    licenseGroups.set(normalized, {
      license: entry.license,
      packages: new Set(),
      noticeText: null,
    });
  }
  const group = licenseGroups.get(normalized);
  group.packages.add(`${entry.name}@${entry.version}`);
  if (entry.noticeText && !group.noticeText) {
    group.noticeText = entry.noticeText;
  }
}

const generatedDate = new Date().toISOString().slice(0, 10);

const lines = [];
lines.push('# Handess Wallet — Third-Party Notices');
lines.push('');
lines.push(`**Applies to:** Handess Wallet ${rootPackage.version} beta  `);
lines.push(`**Generated:** ${generatedDate}  `);
lines.push('**Generated from:** `package-lock.json` and the installed package license files');
lines.push('');
lines.push('Handess Wallet is free software distributed under the GNU General Public License, version 3 or (at your option) any later version (`GPL-3.0-or-later`), in `LICENSE`. This file provides attribution and license notices for third-party software included in the application. It does not change the Handess Wallet license. Each third-party component remains governed by its own license.');
lines.push('');
lines.push('## Runtime and installer components');
lines.push('');
lines.push('- **Electron 28** — MIT License. The Electron license text is installed as `LICENSE.electron.txt` in the application directory.');
lines.push('- **Chromium** — BSD-3-Clause and other licenses. The complete Chromium third-party notices are installed as `LICENSES.chromium.html` in the application directory.');
lines.push('- **Node.js** — not bundled with the installer. If you install Node.js separately, its license applies.');
lines.push('- **hsd** — not bundled with the installer. If you install `hsd` separately, its MIT license applies.');
lines.push('');
lines.push('## Included packages');
lines.push('');
lines.push('| Package | Version | License |');
lines.push('| --- | --- | --- |');
for (const entry of entries) {
  const name = entry.name.replace(/\|/g, '\\|');
  const license = entry.license.replace(/\|/g, '\\|');
  lines.push(`| \`${name}\` | ${entry.version} | ${license} |`);
}
lines.push('');
lines.push(`**Total packages:** ${entries.length}`);
lines.push('');
lines.push('## License texts');
lines.push('');
lines.push('The texts below are reproduced from the installed packages. Package-specific copyright notices are included in the text for each package where the package provides one.');
lines.push('');

let groupIndex = 0;
for (const [text, group] of licenseGroups) {
  groupIndex += 1;
  const packageList = [...group.packages].sort();
  lines.push(`### ${groupIndex}. ${group.license}`);
  lines.push('');
  lines.push(`**Used by:** ${packageList.join(', ')}`);
  lines.push('');
  lines.push('```text');
  lines.push(text);
  lines.push('```');
  lines.push('');
  if (group.noticeText) {
    lines.push('**Additional NOTICE:**');
    lines.push('');
    lines.push('```text');
    lines.push(group.noticeText);
    lines.push('```');
    lines.push('');
  }
}

if (withoutText.length > 0) {
  lines.push('## Packages without a bundled license file');
  lines.push('');
  lines.push('These packages declare a license in `package.json` but did not include a license text file in the installed package:');
  lines.push('');
  for (const entry of withoutText) {
    lines.push(`- \`${entry.name}@${entry.version}\` — ${entry.license}`);
  }
  lines.push('');
}

if (electronLicense) {
  lines.push('## Electron');
  lines.push('');
  lines.push('**Used by:** Handess Wallet desktop runtime');
  lines.push('');
  lines.push('```text');
  lines.push(electronLicense);
  lines.push('```');
  lines.push('');
}

lines.push('## Notes');
lines.push('');
lines.push('- This notices file is generated from the production dependency tree. Build-only tools are not included unless their code is distributed in the application.');
lines.push('- The complete Chromium third-party notices are large and are installed separately as `LICENSES.chromium.html`; that file is the authoritative notice for Chromium and its bundled components.');
lines.push('- If a package provides a separate NOTICE file, it is reproduced with that package\'s license text above.');
lines.push('- This file is informational and does not modify the Handess Wallet GPL license or any third-party license.');
lines.push('');
lines.push('**End of notices.**');
lines.push('');

writeFileSync(outputPath, lines.join('\n'), 'utf8');

const licenses = [...new Set(entries.map((entry) => entry.license))].sort();
console.log(`Wrote ${outputPath}`);
console.log(`Packages: ${entries.length}`);
console.log(`License types: ${licenses.join(', ')}`);
console.log(`License text groups: ${licenseGroups.size}`);
console.log(`Packages without a license file: ${withoutText.length}`);
