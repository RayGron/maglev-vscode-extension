import { CommitMessageProposal, DeployResult, EditProposal, TaskPlanResponse } from '@ai-cvsc/contracts';

export type RunStatus =
  | 'planned'
  | 'edited'
  | 'checked'
  | 'committed'
  | 'pushed'
  | 'deployed';

export interface AgentRunState {
  runId: string;
  task: string;
  summary: string;
  status: RunStatus;
  plan: TaskPlanResponse;
  edits: EditProposal[];
  appliedEdits: EditProposal[];
  commitMessage?: CommitMessageProposal;
  commitHash?: string;
  deployResult?: DeployResult;
}
