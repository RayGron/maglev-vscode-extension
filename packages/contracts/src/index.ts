export type TaskMode =
  | 'inline_completion'
  | 'task_plan'
  | 'edit_patch'
  | 'commit_message'
  | 'terminal_reply'
  | 'deploy_request'
  | 'deploy_summary';

export type ActionKind =
  | 'read'
  | 'write_file'
  | 'run_checks'
  | 'git_commit'
  | 'git_push'
  | 'remote_deploy';

export interface RepositoryContext {
  rootPath: string;
  branch: string;
  changedFiles: string[];
}

export interface PlanStep {
  id: string;
  title: string;
  kind: ActionKind;
  requiresApproval: boolean;
}

export interface TaskPlanResponse {
  summary: string;
  steps: PlanStep[];
}

export interface EditProposal {
  path: string;
  content: string;
  summary: string;
}

export interface CommitMessageProposal {
  title: string;
  body?: string;
}

export interface TerminalReply {
  message: string;
}

export interface InlineCompletionRequest {
  languageId: string;
  filePath: string;
  prefix: string;
  suffix: string;
}

export interface InlineCompletionResponse {
  content: string;
}

export interface DeployRequestProposal {
  host: string;
  repoPath: string;
  branch: string;
  restartCommand?: string;
  healthcheckUrl?: string;
}

export interface DeployResult {
  success: boolean;
  host: string;
  branch: string;
  revision?: string;
  health: 'ok' | 'failed' | 'unknown';
  logs: string[];
}

export interface AgentTaskRequest {
  mode: TaskMode;
  runId: string;
  task: string;
  context: unknown;
  constraints?: unknown;
  metadata?: Record<string, unknown>;
}

export interface GatewayHeaders {
  keyId: string;
  timestamp: number;
  nonce: string;
  signature: string;
  publicKey: string;
}
