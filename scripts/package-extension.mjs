import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const extensionDir = path.join(workspaceRoot, 'apps', 'vscode-extension');
const outputDir = path.join(workspaceRoot, 'dist');
const packagePath = path.join(outputDir, 'maglev-vscode-extension-0.1.0.vsix');
const vsceBin = path.join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vsce.cmd' : 'vsce',
);

await mkdir(outputDir, { recursive: true });

const buildResult = spawnSync(process.execPath, [path.join(workspaceRoot, 'scripts', 'build-extension.mjs'), 'release'], {
  cwd: workspaceRoot,
  stdio: 'inherit',
});

if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

const packageResult = spawnSync(vsceBin, ['package', '--out', packagePath, '--no-dependencies'], {
  cwd: extensionDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (packageResult.status !== 0) {
  process.exit(packageResult.status ?? 1);
}

console.log(`Packaged VS Code extension -> ${packagePath}`);
