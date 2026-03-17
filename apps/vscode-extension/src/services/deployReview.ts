import * as vscode from 'vscode';
import { DeployCommandPreview } from '@ai-cvsc/execution';

export class DeployReviewService {
  async review(preview: DeployCommandPreview): Promise<boolean> {
    const choice = await vscode.window.showInformationMessage(
      [
        `Host: ${preview.host}`,
        `SSH: ${preview.sshCommand}`,
        `Remote: ${preview.remoteCommand}`,
      ].join('\n'),
      { modal: true },
      'Deploy',
      'Cancel',
    );

    return choice === 'Deploy';
  }
}
