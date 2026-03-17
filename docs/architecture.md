# Architecture

## Goal

`maglev-vscode-extension` contains only the VS Code plugin and the TypeScript packages that support it.

The Rust CLI now lives in the separate `maglev` repository.

## Top-level system

```text
VS Code Extension
  -> Local Agent Runtime
  -> Local Executors
     -> Filesystem
     -> Shell
     -> Git
     -> SSH / Deploy
  -> Gateway Client
     -> Secure Gateway or OpenAI-compatible backend
        -> Model
```

## Local execution guarantee

The model may run remotely or locally, but all real side effects must happen from the user's device.

That includes:

- file reads and writes
- shell commands
- git actions
- SSH connections
- remote deploy steps

The extension consumes structured model output and then decides locally whether to execute the proposed actions.

## Repository structure

### VS Code extension

- `apps/vscode-extension/src/extension.ts`
- `apps/vscode-extension/src/ui/taskPanel.ts`
- `apps/vscode-extension/src/ui/runView.ts`
- `apps/vscode-extension/src/providers/inlineCompletionProvider.ts`
- `apps/vscode-extension/src/providers/codeActionProvider.ts`
- `apps/vscode-extension/src/config/settings.ts`
- `apps/vscode-extension/src/services/backendStatus.ts`
- `apps/vscode-extension/src/services/editReview.ts`
- `apps/vscode-extension/src/services/deployReview.ts`

### Shared TypeScript packages

- `packages/agent-runtime`
- `packages/auth`
- `packages/contracts`
- `packages/execution`
- `packages/gateway-client`
- `packages/prompts`

### Shared config and schemas

- `config/model-endpoints.json`
- `schemas/*.json`

## Core flow

`task -> plan -> edit review -> apply -> checks -> commit review -> commit -> push -> optional deploy`

## Build

- `npm run build:extension:debug`
- `npm run build:extension:release`
- `npm run package:extension:release`
- `npm run check`
