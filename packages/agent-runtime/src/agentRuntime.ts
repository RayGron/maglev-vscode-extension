import crypto from 'node:crypto';
import { CommitMessageProposal, DeployRequestProposal, EditProposal } from '@ai-cvsc/contracts';
import { DeployCommandPreview, DeployExecutor, FileExecutor, GitExecutor, PolicyGuard, ShellExecutor } from '@ai-cvsc/execution';
import { AgentGateway } from '@ai-cvsc/gateway-client';
import { Planner } from './planner';
import { AgentRunState } from './runState';
import { StepExecutor } from './stepExecutor';
import { buildRepositoryContext } from './taskContext';

export interface AgentRuntimeDependencies {
  workspaceRoot: string;
  gatewayClient: AgentGateway;
  fileExecutor: FileExecutor;
  shellExecutor: ShellExecutor;
  gitExecutor: GitExecutor;
  deployExecutor: DeployExecutor;
  policyGuard: PolicyGuard;
}

export class AgentRuntime {
  private readonly runs = new Map<string, AgentRunState>();
  private readonly planner: Planner;
  private readonly stepExecutor: StepExecutor;

  constructor(private readonly deps: AgentRuntimeDependencies) {
    this.planner = new Planner(deps.gatewayClient);
    this.stepExecutor = new StepExecutor(
      deps.fileExecutor,
      deps.shellExecutor,
      deps.gitExecutor,
      deps.deployExecutor,
      deps.policyGuard,
    );
  }

  async startRun(task: string): Promise<AgentRunState> {
    const runId = crypto.randomUUID();
    const repository = await buildRepositoryContext(this.deps.workspaceRoot, this.deps.gitExecutor);
    const plan = await this.planner.createPlan(runId, task, repository);
    const edits = await this.deps.gatewayClient.requestEdits(runId, task, repository);

    const run: AgentRunState = {
      runId,
      task,
      summary: plan.summary,
      status: 'planned',
      plan,
      edits,
      appliedEdits: [],
    };

    this.runs.set(runId, run);
    return run;
  }

  getRun(runId: string): AgentRunState {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown run: ${runId}`);
    }

    return run;
  }

  getLatestRun(): AgentRunState | undefined {
    return [...this.runs.values()].at(-1);
  }

  async applyEdits(runId: string, edits: EditProposal[], approved: boolean): Promise<void> {
    const run = this.getRun(runId);
    await this.stepExecutor.applyEdits(edits, approved);
    run.appliedEdits = edits;
    run.status = 'edited';
  }

  async runChecks(runId: string, approved: boolean): Promise<void> {
    const run = this.getRun(runId);
    await this.stepExecutor.runChecks(approved);
    run.status = 'checked';
  }

  async prepareCommitMessage(runId: string): Promise<CommitMessageProposal> {
    const run = this.getRun(runId);
    const proposal = await this.createCommitMessage(runId);
    run.commitMessage = proposal;
    return proposal;
  }

  async commitWithMessage(runId: string, proposal: CommitMessageProposal, approved: boolean): Promise<string> {
    const run = this.getRun(runId);
    const commitHash = await this.stepExecutor.commit(proposal.title, proposal.body, approved);
    run.commitMessage = proposal;
    run.commitHash = commitHash;
    run.status = 'committed';
    return commitHash;
  }

  async commit(runId: string, approved: boolean): Promise<string> {
    const proposal = await this.prepareCommitMessage(runId);
    return this.commitWithMessage(runId, proposal, approved);
  }

  async push(runId: string, approved: boolean): Promise<void> {
    const run = this.getRun(runId);
    await this.stepExecutor.push(approved);
    run.status = 'pushed';
  }

  async prepareDeploy(runId: string, instruction: string): Promise<DeployCommandPreview> {
    const request = await this.requestDeploy(runId, instruction);
    return this.deps.deployExecutor.preview(request);
  }

  async deploy(runId: string, instruction: string, approved: boolean) {
    const run = this.getRun(runId);
    const request = await this.requestDeploy(runId, instruction);
    const result = await this.stepExecutor.deploy(request, approved);
    run.deployResult = result;
    run.status = 'deployed';
    return result;
  }

  private async createCommitMessage(runId: string): Promise<CommitMessageProposal> {
    const run = this.getRun(runId);
    const diffSummary = await this.deps.gitExecutor.diffSummary();
    return this.deps.gatewayClient.requestCommitMessage(runId, run.task, diffSummary);
  }

  private async requestDeploy(runId: string, instruction: string): Promise<DeployRequestProposal> {
    const repository = await buildRepositoryContext(this.deps.workspaceRoot, this.deps.gitExecutor);
    return this.deps.gatewayClient.requestDeploy(runId, instruction, repository);
  }
}
