# maglev-vscode-extension

VS Code extension repository for Maglev.

This repository now contains only the VS Code plugin and its TypeScript support packages:

- `apps/vscode-extension`
- `packages/*`
- `config/model-endpoints.json`

The Rust CLI was split into the separate `maglev` repository.

## Build

- Linux or WSL:
  - `npm ci`
  - `npm run build:extension:debug`
  - `npm run build:extension:release`
  - `npm run package:extension:release`
  - `npm run check`
- Windows:
  - `npm.cmd ci`
  - `npm.cmd run build:extension:debug`
  - `npm.cmd run build:extension:release`
  - `npm.cmd run package:extension:release`
  - `npm.cmd run check`

If you switch the same checkout between Linux/WSL and Windows, rerun the matching install command on that platform before building. The workspace uses platform-specific packages such as `esbuild`, so one shared `node_modules` tree should be refreshed after switching hosts.

From a Remote WSL window, Windows tasks rely on WSL interop. If `cmd.exe /C ver` fails inside WSL, use the Linux tasks until interop is restored.

## VS Code

Workspace tasks and launch configurations in [.vscode](/mnt/e/dev/Repos/maglev-vscode-extension/.vscode) are now extension-only:

- `Extension: Install Dependencies (Linux)`
- `Extension: Build Debug (Linux)`
- `Extension: Build Release (Linux)`
- `Extension: Package Release (Linux)`
- `Extension: Check (Linux)`
- `Extension: Install Dependencies (Windows)`
- `Extension: Build Debug (Windows)`
- `Extension: Build Release (Windows)`
- `Extension: Package Release (Windows)`
- `Extension: Check (Windows)`
- `Run VS Code Extension (Debug Build)`
- `Run VS Code Extension (Release Build)`
