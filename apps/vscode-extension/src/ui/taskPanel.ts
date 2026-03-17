import { AgentRuntime } from '@ai-cvsc/agent-runtime';
import { CommitMessageProposal } from '@ai-cvsc/contracts';
import * as vscode from 'vscode';
import { DeployReviewService } from '../services/deployReview';
import { EditReviewService } from '../services/editReview';
import { RunView } from './runView';

function looksLikeDeployInstruction(task: string): boolean {
  const lowered = task.toLowerCase();
  return lowered.includes('подключись к серверу')
    || lowered.includes('deploy')
    || lowered.includes('connect to server');
}

export class TaskPanel {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly runView: RunView,
    private readonly editReview: EditReviewService,
    private readonly deployReview: DeployReviewService,
  ) {}

  async promptAndRunTask(initialValue?: string): Promise<void> {
    const task = initialValue ?? await vscode.window.showInputBox({
      prompt: 'Describe the task for the local agent runtime',
      ignoreFocusOut: true,
    });

    if (!task) {
      return;
    }

    try {
      const run = await this.runtime.startRun(task);
      await this.runView.showRun(run);

      if (run.edits.length === 0) {
        await vscode.window.showInformationMessage('Run completed planning, but no file edits were proposed.');
        return;
      }

      const selectedEdits = await this.editReview.review(run.edits);
      if (selectedEdits.length === 0) {
        await vscode.window.showInformationMessage('Proposed edits were not applied.');
        return;
      }

      await this.runtime.applyEdits(run.runId, selectedEdits, true);
      await this.runView.showRun(run);
      await vscode.window.showInformationMessage(`Applied ${selectedEdits.length} file change${selectedEdits.length === 1 ? '' : 's'}.`);

      const runChecks = await vscode.window.showInformationMessage(
        'Run local checks now?',
        { modal: true },
        'Run Checks',
        'Skip',
      );
      if (runChecks === 'Run Checks') {
        await this.runtime.runChecks(run.runId, true);
        await this.runView.showRun(run);
        await vscode.window.showInformationMessage('Local checks completed successfully.');
      }

      const createCommit = await vscode.window.showInformationMessage(
        'Create a git commit for these changes?',
        { modal: true },
        'Commit',
        'Skip',
      );
      if (createCommit !== 'Commit') {
        return;
      }

      const proposal = await this.runtime.prepareCommitMessage(run.runId);
      const reviewedCommit = await this.reviewCommitMessage(proposal);
      if (!reviewedCommit) {
        await vscode.window.showInformationMessage('Commit was cancelled before git commit.');
        return;
      }

      const commitHash = await this.runtime.commitWithMessage(run.runId, reviewedCommit, true);
      await this.runView.showRun(run);
      await vscode.window.showInformationMessage(`Created commit ${commitHash}.`);

      const pushBranch = await vscode.window.showInformationMessage(
        'Push the current branch to origin?',
        { modal: true },
        'Push',
        'Skip',
      );
      if (pushBranch !== 'Push') {
        return;
      }

      await this.runtime.push(run.runId, true);
      await this.runView.showRun(run);
      await vscode.window.showInformationMessage('Branch pushed successfully.');

      if (looksLikeDeployInstruction(task)) {
        await this.executeDeploy(run.runId, task);
      }
    } catch (error) {
      await vscode.window.showErrorMessage(`Maglev run failed: ${(error as Error).message}`);
    }
  }

  async promptAndDeployLatest(initialInstruction?: string): Promise<void> {
    const run = this.runtime.getLatestRun();
    if (!run) {
      await vscode.window.showWarningMessage('No run available for deploy. Start a task run first.');
      return;
    }

    const instruction = initialInstruction ?? await vscode.window.showInputBox({
      prompt: 'Describe the deploy target, for example: подключись к серверу 10.0.0.5',
      ignoreFocusOut: true,
      value: run.task,
    });

    if (!instruction) {
      return;
    }

    try {
      await this.executeDeploy(run.runId, instruction);
    } catch (error) {
      await vscode.window.showErrorMessage(`Deploy failed: ${(error as Error).message}`);
    }
  }

  private async reviewCommitMessage(proposal: CommitMessageProposal): Promise<CommitMessageProposal | undefined> {
    const title = await vscode.window.showInputBox({
      prompt: 'Review commit title',
      ignoreFocusOut: true,
      value: proposal.title,
      validateInput: (value) => value.trim() ? undefined : 'Commit title cannot be empty.',
    });

    if (!title) {
      return undefined;
    }

    const body = await vscode.window.showInputBox({
      prompt: 'Review commit body (optional)',
      ignoreFocusOut: true,
      value: proposal.body ?? '',
    });

    if (body === undefined) {
      return undefined;
    }

    const normalizedBody = body.trim();
    return {
      title: title.trim(),
      body: normalizedBody || undefined,
    };
  }

  private async executeDeploy(runId: string, instruction: string): Promise<void> {
    const preview = await this.runtime.prepareDeploy(runId, instruction);
    const approved = await this.deployReview.review(preview);
    if (!approved) {
      await vscode.window.showInformationMessage('Deploy was cancelled.');
      return;
    }

    const result = await this.runtime.deploy(runId, instruction, true);
    await this.runView.showRun(this.runtime.getRun(runId));
    const message = result.success
      ? `Deploy completed for ${result.host}. Health: ${result.health}.`
      : `Deploy failed for ${result.host}. Health: ${result.health}.`;

    if (result.success) {
      await vscode.window.showInformationMessage(message);
      return;
    }

    await vscode.window.showErrorMessage(message);
  }
}
