import * as vscode from 'vscode';
import { AgentRunState } from '@ai-cvsc/agent-runtime';

export class RunView {
  async showRun(run: AgentRunState): Promise<void> {
    const steps = run.plan.steps.map((step) => `- [${step.requiresApproval ? 'approval' : 'auto'}] ${step.title}`).join('\n');
    const edits = run.edits.length > 0
      ? run.edits.map((edit) => `- \`${edit.path}\`: ${edit.summary}`).join('\n')
      : '- No proposed edits';
    const appliedEdits = run.appliedEdits.length > 0
      ? run.appliedEdits.map((edit) => `- \`${edit.path}\`: ${edit.summary}`).join('\n')
      : '- No applied edits';
    const commitMessage = run.commitMessage
      ? [
          `- Title: ${run.commitMessage.title}`,
          run.commitMessage.body ? `- Body: ${run.commitMessage.body}` : '- Body: <empty>',
        ].join('\n')
      : '- No commit message prepared';
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: [
        `# Run ${run.runId}`,
        '',
        `Task: ${run.task}`,
        '',
        `Status: ${run.status}`,
        '',
        `Summary: ${run.summary}`,
        '',
        '## Plan',
        steps || '- No plan steps',
        '',
        '## Proposed Edits',
        edits,
        '',
        '## Applied Edits',
        appliedEdits,
        '',
        '## Commit Message',
        commitMessage,
        run.commitHash ? `\n## Commit\n- ${run.commitHash}` : '',
        run.deployResult ? `\n## Deploy\n- Host: ${run.deployResult.host}\n- Health: ${run.deployResult.health}` : '',
      ].join('\n'),
    });

    await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  }
}
