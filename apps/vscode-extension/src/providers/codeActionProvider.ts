import * as vscode from 'vscode';

export class CodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const selectedText = document.getText(range);

    const runTask = new vscode.CodeAction('Maglev: Run Task', vscode.CodeActionKind.Refactor);
    runTask.command = {
      command: 'aiCvsc.runTask',
      title: 'Maglev: Run Task',
    };
    actions.push(runTask);

    const showStatus = new vscode.CodeAction('Maglev: Show Status', vscode.CodeActionKind.Empty);
    showStatus.command = {
      command: 'aiCvsc.showStatus',
      title: 'Maglev: Show Status',
    };
    actions.push(showStatus);

    const deployLatest = new vscode.CodeAction('Maglev: Deploy Latest Run', vscode.CodeActionKind.Source);
    deployLatest.command = {
      command: 'aiCvsc.deployLatest',
      title: 'Maglev: Deploy Latest Run',
    };
    actions.push(deployLatest);

    if (selectedText.trim()) {
      const explainSelection = new vscode.CodeAction('Maglev: Run Task For Selection', vscode.CodeActionKind.QuickFix);
      explainSelection.command = {
        command: 'aiCvsc.runTask',
        title: 'Maglev: Run Task',
        arguments: [`Explain or improve this code selection:\n\n${selectedText}`],
      };
      actions.push(explainSelection);
    }

    return actions;
  }
}
