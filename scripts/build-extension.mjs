import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';

const mode = process.argv[2] === 'release' ? 'release' : 'debug';
const isRelease = mode === 'release';
const workspaceRoot = path.resolve(import.meta.dirname, '..');
const entryPoint = path.join(workspaceRoot, 'apps', 'vscode-extension', 'src', 'extension.ts');
const outdir = path.join(workspaceRoot, 'apps', 'vscode-extension', 'dist');

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  absWorkingDir: workspaceRoot,
  entryPoints: [entryPoint],
  outfile: path.join(outdir, 'extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: isRelease ? false : 'linked',
  minify: isRelease,
  sourcesContent: !isRelease,
  legalComments: 'none',
  logLevel: 'info',
  tsconfig: path.join(workspaceRoot, 'tsconfig.json'),
  define: {
    'process.env.NODE_ENV': JSON.stringify(isRelease ? 'production' : 'development'),
  },
});

console.log(`Built VS Code extension (${mode}) -> apps/vscode-extension/dist/extension.js`);
