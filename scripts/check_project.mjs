import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const runtimeJavaScriptFiles = [
  'src/app.js',
  'src/data/songsApi.js',
  'src/domain/songCatalog.js',
  'src/features/danmaku.js',
  'src/features/scrollBubbles.js',
  'src/platform/clipboard.js',
  'src/platform/pwa.js',
  'src/platform/storage.js',
  'src/state/appState.js',
  'src/ui/dom.js',
  'src/ui/renderSongs.js',
  'src/ui/status.js',
  'src/ui/swipeTrack.js',
  'src/utils/scheduling.js',
  'scripts/build_songs_snapshot.mjs',
  'scripts/lib/songSnapshot.mjs',
  'sw.js',
];

const appsScriptFiles = [
  'gas/Code.gs',
  'sheet_scripts/performance_record.gs',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checkJavaScriptSyntax(file) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `Syntax check failed: ${file}\n${result.stderr || result.stdout}`,
    );
  }
}

async function checkAppsScriptSyntax(file) {
  const source = await readFile(file, 'utf8');
  new vm.Script(source, { filename: file });
}

async function checkJson(file) {
  JSON.parse(await readFile(file, 'utf8'));
}

async function checkIndexHtml() {
  const html = await readFile('index.html', 'utf8');
  assert(
    /<link\b[^>]*\bhref=["']assets\/styles\.css["']/i.test(html),
    'index.html must load assets/styles.css',
  );

  const ids = Array.from(
    html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi),
    (match) => match[1],
  );
  const duplicateIds = ids.filter(
    (id, index) => ids.indexOf(id) !== index,
  );
  assert(
    duplicateIds.length === 0,
    `Duplicate HTML id(s): ${Array.from(new Set(duplicateIds)).join(', ')}`,
  );
}

async function checkManifestIcons() {
  const manifestPath = 'assets/icons/site.webmanifest';
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert(Array.isArray(manifest.icons), `${manifestPath} icons must be an array`);

  for (const icon of manifest.icons) {
    const src = String(icon?.src || '').trim();
    assert(src, `${manifestPath} contains an icon without src`);
    assert(
      existsSync(resolve('assets/icons', src)),
      `Missing manifest icon: assets/icons/${src}`,
    );
  }
}

async function checkServiceWorkerShell() {
  const source = await readFile('sw.js', 'utf8');
  const shellBlock = source.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert(shellBlock, 'sw.js APP_SHELL could not be found');

  const shellFiles = Array.from(
    shellBlock[1].matchAll(/'(\.\/[^']+)'/g),
    (match) => match[1],
  );
  assert(shellFiles.length > 0, 'sw.js APP_SHELL is empty');
  assert(
    new Set(shellFiles).size === shellFiles.length,
    'sw.js APP_SHELL contains duplicate entries',
  );

  for (const shellFile of shellFiles) {
    if (shellFile === './') continue;
    const localPath = resolve(shellFile.slice(2));
    assert(existsSync(localPath), `Missing Service Worker shell file: ${shellFile}`);
  }
}

async function main() {
  runtimeJavaScriptFiles.forEach(checkJavaScriptSyntax);
  await Promise.all(appsScriptFiles.map(checkAppsScriptSyntax));
  await Promise.all([
    checkJson('package.json'),
    checkJson('package-lock.json'),
    checkJson('assets/icons/site.webmanifest'),
  ]);
  await Promise.all([
    checkIndexHtml(),
    checkManifestIcons(),
    checkServiceWorkerShell(),
  ]);
  console.log(
    `Project check passed: ${runtimeJavaScriptFiles.length} JavaScript, `
    + `${appsScriptFiles.length} Apps Script, JSON and Service Worker shell.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
