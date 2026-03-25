import fs from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import { EditProposal } from '@ai-cvsc/contracts';

export class EditReviewService {
  constructor(private readonly workspaceRoot: string) {}

  async previewEdit(edit: EditProposal): Promise<void> {
    await this.openDiff(edit);
  }

  async previewEdits(edits: EditProposal[]): Promise<void> {
    const previewEdits = edits.slice(0, 5);
    for (const edit of previewEdits) {
      await this.openDiff(edit);
    }
  }

  async review(edits: EditProposal[]): Promise<EditProposal[]> {
    if (edits.length === 0) {
      return [];
    }

    const previewEdits = edits.slice(0, 5);
    await this.previewEdits(previewEdits);

    if (edits.length > previewEdits.length) {
      await vscode.window.showInformationMessage(
        `Opened ${previewEdits.length} of ${edits.length} diffs for review.`,
      );
    }

    const selectedPaths = await vscode.window.showQuickPick(
      edits.map((edit) => ({
        label: edit.path,
        description: edit.summary,
        picked: true,
      })),
      {
        canPickMany: true,
        ignoreFocusOut: true,
        title: 'Select the file changes to apply',
        placeHolder: 'Choose one or more proposed edits',
      },
    );

    if (!selectedPaths || selectedPaths.length === 0) {
      return [];
    }

    const selectedPathSet = new Set(selectedPaths.map((item) => item.label));
    const selectedEdits = edits.filter((edit) => selectedPathSet.has(edit.path));
    const choice = await vscode.window.showInformationMessage(
      `Apply ${selectedEdits.length} selected file change${selectedEdits.length === 1 ? '' : 's'}?`,
      { modal: true },
      'Apply',
      'Cancel',
    );

    return choice === 'Apply' ? selectedEdits : [];
  }

  private async openDiff(edit: EditProposal): Promise<void> {
    const absolutePath = path.join(this.workspaceRoot, edit.path);
    const originalDocument = await this.openOriginalDocument(absolutePath);
    const updatedDocument = await vscode.workspace.openTextDocument({
      content: edit.content,
      language: originalDocument.languageId !== 'plaintext' ? originalDocument.languageId : undefined,
    });

    await vscode.commands.executeCommand(
      'vscode.diff',
      originalDocument.uri,
      updatedDocument.uri,
      `Maglev Review: ${edit.path}`,
      {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside,
      },
    );
  }

  private async openOriginalDocument(absolutePath: string): Promise<vscode.TextDocument> {
    try {
      await fs.access(absolutePath);
      return await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath));
    } catch {
      return vscode.workspace.openTextDocument({
        content: '',
      });
    }
  }
}
