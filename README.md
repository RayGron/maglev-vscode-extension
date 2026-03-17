# maglev-vscode-extension

VS Code extension repository for Maglev.

This repository now contains only the VS Code plugin and its TypeScript support packages:

- `apps/vscode-extension`
- `packages/*`
- `config/model-endpoints.json`

The Rust CLI was split into the separate `maglev` repository.

## Build

- `npm run build:extension:debug`
- `npm run build:extension:release`
- `npm run package:extension:release`
- `npm run check`

## VS Code

Workspace tasks and launch configurations in [.vscode](/mnt/e/dev/Repos/maglev-vscode-extension/.vscode) are now extension-only:

- `Extension: Build Debug`
- `Extension: Build Release`
- `Extension: Package Release`
- `Run VS Code Extension (Debug Build)`
- `Run VS Code Extension (Release Build)`
