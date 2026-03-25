import * as vscode from 'vscode';
import { AgentRuntime } from '@ai-cvsc/agent-runtime';
import { KeyManager } from '@ai-cvsc/auth';
import { DeployExecutor, FileExecutor, GitExecutor, PolicyGuard, ShellExecutor } from '@ai-cvsc/execution';
import { createAgentGateway } from '@ai-cvsc/gateway-client';
import { getExtensionSettings } from './config/settings';
import { CodeActionProvider } from './providers/codeActionProvider';
import { InlineCompletionProvider } from './providers/inlineCompletionProvider';
import { getBackendStatus } from './services/backendStatus';
import { DeployReviewService } from './services/deployReview';
import { EditReviewService } from './services/editReview';
import { AgentPanelViewProvider } from './ui/agentPanelView';
import { RunView } from './ui/runView';
import { TaskPanel } from './ui/taskPanel';

export function activate(context: vscode.ExtensionContext): void {
  const settings = getExtensionSettings();
  const keyManager = new KeyManager();
  const gatewayClient = createAgentGateway(settings, keyManager);
  const shellExecutor = new ShellExecutor();
  const editReviewService = new EditReviewService(settings.workspaceRoot);
  const runtime = new AgentRuntime({
    workspaceRoot: settings.workspaceRoot,
    gatewayClient,
    fileExecutor: new FileExecutor(),
    shellExecutor,
    gitExecutor: new GitExecutor(shellExecutor, settings.workspaceRoot),
    deployExecutor: new DeployExecutor(shellExecutor),
    policyGuard: new PolicyGuard(),
  });

  const taskPanel = new TaskPanel(
    runtime,
    new RunView(),
    editReviewService,
    new DeployReviewService(),
  );
  const agentPanelView = new AgentPanelViewProvider(
    context.extensionUri,
    runtime,
    {
      fetchBackendStatus: async () => getBackendStatus(settings),
      openEditPreview: async (edit) => editReviewService.previewEdit(edit),
      askAgent: async (runId, task, details) => gatewayClient.terminalReply(runId, task, details),
    },
  );

  context.subscriptions.push(
    agentPanelView,
    vscode.window.registerWebviewViewProvider(AgentPanelViewProvider.viewType, agentPanelView),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiCvsc.runTask', async (initialTask?: string) => {
      if (initialTask?.trim()) {
        await agentPanelView.reveal(initialTask);
        await agentPanelView.runTask(initialTask);
        return;
      }

      await agentPanelView.reveal();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiCvsc.openAgentPanel', async () => {
      await agentPanelView.reveal();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiCvsc.showStatus', async () => {
      const run = runtime.getLatestRun();
      try {
        const backendStatus = await getBackendStatus(settings);
        const runInfo = run ? ` Latest run ${run.runId}: ${run.status}.` : ' No runs yet.';
        const modelsInfo = backendStatus.availableModels.length > 0
          ? ` Available models: ${backendStatus.availableModels.join(', ')}.`
          : '';
        const message = `${backendStatus.message} Endpoint: ${backendStatus.endpoint}.${runInfo}${modelsInfo}`;

        if (backendStatus.availableModels.length > 0 && !backendStatus.availableModels.includes(settings.model)) {
          await vscode.window.showWarningMessage(message);
          return;
        }

        await vscode.window.showInformationMessage(message);
      } catch (error) {
        const message = `Backend check failed for ${settings.apiBaseUrl}: ${(error as Error).message}`;
        await vscode.window.showErrorMessage(message);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiCvsc.deployLatest', async (initialInstruction?: string) => {
      await taskPanel.promptAndDeployLatest(initialInstruction);
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, new InlineCompletionProvider(gatewayClient)),
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider({ pattern: '**' }, new CodeActionProvider()),
  );
}

export function deactivate(): void {}
