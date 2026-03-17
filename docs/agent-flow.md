# Agent Flow

## Target user journey for VS Code plugin

1. User enters a task in VS Code.
2. Extension creates a run and captures repository context.
3. Local runtime asks the model for a task plan.
4. Runtime reads files and requests code patches or new file content.
5. Runtime writes changes and optionally runs tests or linters.
6. Runtime shows diff to the user.
7. After approval, runtime creates commit message and performs commit.
8. After separate approval, runtime pushes branch.
9. After separate approval, runtime deploys to a remote server and performs `git pull`.
10. Extension shows final summary and deployment status.

All of these actions are executed by the local runtime on the user's machine. The model and gateway do not perform file, shell, git, or SSH actions remotely.

## What lives where

### In the VS Code plugin

- collect task text
- show progress
- render diffs
- ask for approvals
- manage local credentials and settings

### In the shared local agent runtime

- planning
- patch generation requests
- file editing
- command execution
- git workflow
- deploy orchestration

### In the secure gateway

- authentication
- rate limit
- routing by mode
- prompt templates
- response cleanup
- audit logging

### On the server

- model serving
- deploy target repository
- service restart
- health endpoints

## Recommended approvals

Three checkpoints are enough for the first version:

1. `Apply code changes`
2. `Create commit and push`
3. `Deploy to remote server`

This keeps the system usable while still preventing silent destructive actions.

## Recommended deploy contract

Preferred contract:

- plugin/runtime sends a structured deploy request
- deploy executor connects to the target host
- runs `git fetch`, `git checkout`, `git pull`
- restarts service
- verifies `/health`

Structured deploy response:

```json
{
  "success": true,
  "host": "prod-1",
  "branch": "main",
  "revision": "abc1234",
  "health": "ok",
  "logs": []
}
```

## Main implementation risk

The hardest part is not code generation. It is the control plane:

- approvals
- execution safety
- git state handling
- deploy rollback behavior
- clear auditability

That is why the agent runtime and gateway should be treated as first-class components, not as helper code around the model.
