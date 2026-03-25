import * as vscode from 'vscode';
import { AgentRunState, AgentRuntime } from '@ai-cvsc/agent-runtime';
import { CommitMessageProposal } from '@ai-cvsc/contracts';
import { BackendStatus } from '../services/backendStatus';

interface AgentPanelCallbacks {
  fetchBackendStatus(): Promise<BackendStatus>;
  openEditPreview(edit: { path: string; content: string; summary: string }): Promise<void>;
  askAgent(runId: string, task: string, details: Record<string, unknown>): Promise<{ message: string }>;
}

interface AgentTranscriptMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
}

interface AgentPanelState {
  chatDraft: string;
  isBusy: boolean;
  phase: string;
  infoMessage: string;
  errorMessage: string;
  backendStatus?: BackendStatus;
  latestRun?: AgentRunState;
  selectedEditPaths: string[];
  commitDraftTitle: string;
  commitDraftBody: string;
  transcript: AgentTranscriptMessage[];
}

type PanelMessage =
  | { type: 'ready' }
  | { type: 'chatDraftChanged'; task?: string }
  | { type: 'askAgent'; task?: string }
  | { type: 'runTask'; task?: string }
  | { type: 'refresh' }
  | { type: 'toggleEdit'; path?: string; selected?: boolean }
  | { type: 'openEditPreview'; path?: string }
  | { type: 'applySelectedEdits' }
  | { type: 'runChecks' }
  | { type: 'prepareCommit' }
  | { type: 'commitDraftChanged'; title?: string; body?: string }
  | { type: 'commit' }
  | { type: 'push' };

export class AgentPanelViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'aiCvsc.agentPanel';

  private view?: vscode.WebviewView;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly conversationId = `chat-${Date.now()}`;
  private state: AgentPanelState = {
    chatDraft: '',
    isBusy: false,
    phase: 'Idle',
    infoMessage: 'Ready to start a conversation.',
    errorMessage: '',
    selectedEditPaths: [],
    commitDraftTitle: '',
    commitDraftBody: '',
    transcript: [
      {
        role: 'system',
        text: 'Maglev agent is ready. Ask questions like in Codex, or promote a message into a task run.',
      },
    ],
  };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly runtime: AgentRuntime,
    private readonly callbacks: AgentPanelCallbacks,
  ) {}

  dispose(): void {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  async reveal(chatDraft?: string): Promise<void> {
    if (typeof chatDraft === 'string') {
      this.state.chatDraft = chatDraft;
    }

    await vscode.commands.executeCommand('workbench.view.explorer');
    try {
      await vscode.commands.executeCommand(`${AgentPanelViewProvider.viewType}.focus`);
    } catch {
      this.postState();
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.render(webviewView.webview);

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage(async (message: PanelMessage) => {
        await this.handleMessage(message);
      }),
      webviewView.onDidDispose(() => {
        this.view = undefined;
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          void this.refresh();
        }
      }),
    );

    void this.refresh();
  }

  private async handleMessage(message: PanelMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.refresh();
        this.postState();
        return;
      case 'chatDraftChanged':
        this.state.chatDraft = message.task ?? '';
        return;
      case 'askAgent':
        await this.askAgent(message.task ?? this.state.chatDraft);
        return;
      case 'runTask':
        await this.runTask(message.task ?? this.state.chatDraft);
        return;
      case 'refresh':
        await this.refresh();
        return;
      case 'toggleEdit':
        this.toggleEditSelection(message.path, message.selected);
        this.postState();
        return;
      case 'openEditPreview':
        await this.openEditPreview(message.path);
        return;
      case 'applySelectedEdits':
        await this.applySelectedEdits();
        return;
      case 'runChecks':
        await this.runChecks();
        return;
      case 'prepareCommit':
        await this.prepareCommit();
        return;
      case 'commitDraftChanged':
        this.state.commitDraftTitle = message.title ?? '';
        this.state.commitDraftBody = message.body ?? '';
        return;
      case 'commit':
        await this.commit();
        return;
      case 'push':
        await this.push();
        return;
      default:
        return;
    }
  }

  async refresh(): Promise<void> {
    try {
      this.state.backendStatus = await this.callbacks.fetchBackendStatus();
      this.state.latestRun = this.runtime.getLatestRun();
      if (this.state.latestRun) {
        this.syncRunDerivedState(this.state.latestRun);
      }
      this.state.errorMessage = '';
      if (!this.state.isBusy) {
        this.state.infoMessage = this.state.backendStatus.message;
      }
    } catch (error) {
      this.state.errorMessage = `Backend check failed: ${(error as Error).message}`;
    }

    this.postState();
  }

  async askAgent(task: string): Promise<void> {
    const normalizedTask = task.trim();
    if (!normalizedTask || this.state.isBusy) {
      return;
    }

    this.state.chatDraft = normalizedTask;
    this.state.isBusy = true;
    this.state.phase = 'Waiting for agent reply';
    this.state.infoMessage = 'Sending your message to the selected model.';
    this.state.errorMessage = '';
    this.appendTranscript('user', normalizedTask);
    this.postState();

    try {
      const reply = await this.callbacks.askAgent(
        this.state.latestRun?.runId ?? this.conversationId,
        normalizedTask,
        {
          transcript: this.state.transcript.slice(-12),
          latestRun: this.serializeRun(this.state.latestRun),
          phase: this.state.phase,
        },
      );
      this.appendTranscript('assistant', reply.message);
      this.state.chatDraft = '';
      this.state.phase = 'Chat ready';
      this.state.infoMessage = 'Agent reply received.';
    } catch (error) {
      this.state.phase = 'Failed';
      this.state.errorMessage = `Agent reply failed: ${(error as Error).message}`;
      this.appendTranscript('system', `Agent reply failed: ${(error as Error).message}`);
    } finally {
      this.state.isBusy = false;
      this.postState();
    }
  }

  async runTask(task: string): Promise<void> {
    const normalizedTask = task.trim();
    if (!normalizedTask || this.state.isBusy) {
      return;
    }

    this.state.chatDraft = normalizedTask;
    this.state.isBusy = true;
    this.state.phase = 'Planning task';
    this.state.infoMessage = 'Requesting plan and proposed edits from Maglev.';
    this.state.errorMessage = '';
    this.state.commitDraftTitle = '';
    this.state.commitDraftBody = '';
    this.appendTranscript('user', normalizedTask);
    this.appendTranscript('system', 'Starting a task run.');
    this.postState();

    try {
      const run = await this.runtime.startRun(normalizedTask);
      this.state.latestRun = run;
      this.state.selectedEditPaths = run.edits.map((edit) => edit.path);
      this.state.phase = run.edits.length > 0 ? 'Plan ready for review' : 'Plan ready';
      this.state.infoMessage = run.edits.length > 0
        ? `Run ${run.runId} is ready. Review the proposed edits below.`
        : `Run ${run.runId} completed planning without file edits.`;
      this.state.errorMessage = '';
      this.appendTranscript('assistant', run.summary);
      this.appendTranscript(
        'system',
        run.edits.length > 0
          ? `Prepared ${run.edits.length} proposed edit${run.edits.length === 1 ? '' : 's'} for review.`
          : 'The run completed planning without proposing file edits.',
      );
      this.state.chatDraft = '';
    } catch (error) {
      this.state.errorMessage = `Run failed: ${(error as Error).message}`;
      this.state.infoMessage = '';
      this.state.phase = 'Failed';
      this.appendTranscript('system', `Task run failed: ${(error as Error).message}`);
    } finally {
      this.state.isBusy = false;
      this.postState();
    }
  }

  private toggleEditSelection(path: string | undefined, selected: boolean | undefined): void {
    if (!path) {
      return;
    }

    const next = new Set(this.state.selectedEditPaths);
    if (selected) {
      next.add(path);
    } else {
      next.delete(path);
    }
    this.state.selectedEditPaths = [...next];
  }

  private async openEditPreview(path: string | undefined): Promise<void> {
    const run = this.requireLatestRun();
    const edit = run.edits.find((candidate) => candidate.path === path);
    if (!edit) {
      this.state.errorMessage = 'Unable to find the selected edit preview.';
      this.postState();
      return;
    }

    try {
      await this.callbacks.openEditPreview(edit);
      this.state.errorMessage = '';
      this.state.infoMessage = `Opened diff preview for ${edit.path}.`;
      this.postState();
    } catch (error) {
      this.state.errorMessage = `Failed to open diff preview: ${(error as Error).message}`;
      this.postState();
    }
  }

  private async applySelectedEdits(): Promise<void> {
    const run = this.requireLatestRun();
    if (run.appliedEdits.length > 0) {
      return;
    }

    const selectedEdits = run.edits.filter((edit) => this.state.selectedEditPaths.includes(edit.path));
    if (selectedEdits.length === 0) {
      this.state.errorMessage = 'Select at least one proposed edit before applying changes.';
      this.postState();
      return;
    }

    await this.executeBusyAction('Applying selected edits', async () => {
      await this.runtime.applyEdits(run.runId, selectedEdits, true);
      const updatedRun = this.runtime.getRun(run.runId);
      this.state.latestRun = updatedRun;
      this.state.infoMessage = `Applied ${selectedEdits.length} file change${selectedEdits.length === 1 ? '' : 's'}.`;
      this.syncRunDerivedState(updatedRun);
      this.appendTranscript('system', `Applied ${selectedEdits.length} selected edit${selectedEdits.length === 1 ? '' : 's'}.`);
    });
  }

  private async runChecks(): Promise<void> {
    const run = this.requireLatestRun();
    await this.executeBusyAction('Running local checks', async () => {
      await this.runtime.runChecks(run.runId, true);
      const updatedRun = this.runtime.getRun(run.runId);
      this.state.latestRun = updatedRun;
      this.state.infoMessage = 'Local checks completed successfully.';
      this.syncRunDerivedState(updatedRun);
      this.appendTranscript('system', 'Local checks completed successfully.');
    });
  }

  private async prepareCommit(): Promise<void> {
    const run = this.requireLatestRun();
    await this.executeBusyAction('Preparing commit message', async () => {
      const proposal = await this.runtime.prepareCommitMessage(run.runId);
      this.state.latestRun = this.runtime.getRun(run.runId);
      this.state.commitDraftTitle = proposal.title;
      this.state.commitDraftBody = proposal.body ?? '';
      this.state.infoMessage = 'Commit draft is ready for review.';
      this.appendTranscript('system', 'Prepared a commit message draft for review.');
    });
  }

  private async commit(): Promise<void> {
    const run = this.requireLatestRun();
    const proposal = this.buildCommitProposal();
    await this.executeBusyAction('Creating git commit', async () => {
      const commitHash = await this.runtime.commitWithMessage(run.runId, proposal, true);
      const updatedRun = this.runtime.getRun(run.runId);
      this.state.latestRun = updatedRun;
      this.state.infoMessage = `Created commit ${commitHash}.`;
      this.syncRunDerivedState(updatedRun);
      this.appendTranscript('system', `Created commit ${commitHash}.`);
    });
  }

  private async push(): Promise<void> {
    const run = this.requireLatestRun();
    await this.executeBusyAction('Pushing branch', async () => {
      await this.runtime.push(run.runId, true);
      const updatedRun = this.runtime.getRun(run.runId);
      this.state.latestRun = updatedRun;
      this.state.infoMessage = 'Branch pushed successfully.';
      this.syncRunDerivedState(updatedRun);
      this.appendTranscript('system', 'Pushed the current branch.');
    });
  }

  private async executeBusyAction(phase: string, action: () => Promise<void>): Promise<void> {
    if (this.state.isBusy) {
      return;
    }

    this.state.isBusy = true;
    this.state.phase = phase;
    this.state.errorMessage = '';
    this.postState();

    try {
      await action();
      this.state.phase = 'Ready for next step';
    } catch (error) {
      this.state.errorMessage = (error as Error).message;
      this.state.phase = 'Failed';
      this.appendTranscript('system', `${phase} failed: ${(error as Error).message}`);
    } finally {
      this.state.isBusy = false;
      this.postState();
    }
  }

  private requireLatestRun(): AgentRunState {
    const run = this.state.latestRun ?? this.runtime.getLatestRun();
    if (!run) {
      throw new Error('No run available yet. Start a task first.');
    }

    return run;
  }

  private buildCommitProposal(): CommitMessageProposal {
    const title = this.state.commitDraftTitle.trim();
    if (!title) {
      throw new Error('Commit title cannot be empty.');
    }

    const body = this.state.commitDraftBody.trim();
    return {
      title,
      body: body || undefined,
    };
  }

  private syncRunDerivedState(run: AgentRunState): void {
    if (run.appliedEdits.length === 0) {
      if (this.state.selectedEditPaths.length === 0) {
        this.state.selectedEditPaths = run.edits.map((edit) => edit.path);
      } else {
        const existing = new Set(run.edits.map((edit) => edit.path));
        this.state.selectedEditPaths = this.state.selectedEditPaths.filter((path) => existing.has(path));
      }
    }

    if (run.commitMessage) {
      this.state.commitDraftTitle = run.commitMessage.title;
      this.state.commitDraftBody = run.commitMessage.body ?? '';
    }
  }

  private appendTranscript(role: AgentTranscriptMessage['role'], text: string): void {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }

    this.state.transcript = [...this.state.transcript, { role, text: normalized }].slice(-40);
  }

  private serializeRun(run: AgentRunState | undefined) {
    if (!run) {
      return undefined;
    }

    return {
      runId: run.runId,
      task: run.task,
      summary: run.summary,
      status: run.status,
      stepCount: run.plan.steps.length,
      steps: run.plan.steps.map((step) => ({
        title: step.title,
        approval: step.requiresApproval,
      })),
      edits: run.edits.map((edit) => ({
        path: edit.path,
        summary: edit.summary,
        selected: this.state.selectedEditPaths.includes(edit.path),
      })),
      proposedEditCount: run.edits.length,
      appliedEditCount: run.appliedEdits.length,
      commitTitle: run.commitMessage?.title,
      commitHash: run.commitHash,
      deployHost: run.deployResult?.host,
      deployHealth: run.deployResult?.health,
      deploySuccess: run.deployResult?.success,
    };
  }

  private serializeActions() {
    const run = this.state.latestRun;
    const selectedCount = run
      ? run.edits.filter((edit) => this.state.selectedEditPaths.includes(edit.path)).length
      : 0;
    const canApplyEdits = !this.state.isBusy && !!run && run.appliedEdits.length === 0 && selectedCount > 0;
    const canRunChecks = !this.state.isBusy
      && !!run
      && run.appliedEdits.length > 0
      && run.status !== 'checked'
      && run.status !== 'committed'
      && run.status !== 'pushed'
      && run.status !== 'deployed';
    const canPrepareCommit = !this.state.isBusy && !!run && run.appliedEdits.length > 0 && !run.commitHash;
    const canCommit = !this.state.isBusy
      && !!run
      && run.appliedEdits.length > 0
      && !run.commitHash
      && this.state.commitDraftTitle.trim().length > 0;
    const canPush = !this.state.isBusy && !!run?.commitHash && run.status !== 'pushed' && run.status !== 'deployed';

    return {
      canAskAgent: !this.state.isBusy && this.state.chatDraft.trim().length > 0,
      canRunTask: !this.state.isBusy && this.state.chatDraft.trim().length > 0,
      canApplyEdits,
      canRunChecks,
      canPrepareCommit,
      canCommit,
      canPush,
    };
  }

  private postState(): void {
    this.view?.webview.postMessage({
      type: 'state',
      payload: {
        chatDraft: this.state.chatDraft,
        isBusy: this.state.isBusy,
        phase: this.state.phase,
        infoMessage: this.state.infoMessage,
        errorMessage: this.state.errorMessage,
        transcript: this.state.transcript,
        backendStatus: this.state.backendStatus
          ? {
              endpoint: this.state.backendStatus.endpoint,
              model: this.state.backendStatus.configuredModel,
              availableModels: this.state.backendStatus.availableModels,
              message: this.state.backendStatus.message,
            }
          : undefined,
        latestRun: this.serializeRun(this.state.latestRun),
        commitDraft: {
          title: this.state.commitDraftTitle,
          body: this.state.commitDraftBody,
        },
        actions: this.serializeActions(),
      },
    });
  }

  private render(webview: vscode.Webview): string {
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Maglev Agent</title>
    <style>
      :root {
        color-scheme: light dark;
      }

      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        margin: 0;
        padding: 16px;
      }

      .shell {
        display: grid;
        gap: 16px;
      }

      .card {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 10px;
        background: color-mix(in srgb, var(--vscode-sideBar-background) 88%, var(--vscode-editor-background));
        padding: 14px;
      }

      h1,
      h2,
      h3,
      p {
        margin: 0;
      }

      .hero,
      .section,
      .kv {
        display: grid;
        gap: 10px;
      }

      .hero h1 {
        font-size: 15px;
        font-weight: 700;
      }

      .muted,
      .list li,
      .edit-summary,
      .bubble-role {
        color: var(--vscode-descriptionForeground);
      }

      .status-row,
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 3px 10px;
        font-size: 12px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
      }

      textarea,
      input[type="text"] {
        width: 100%;
        box-sizing: border-box;
        border-radius: 8px;
        border: 1px solid var(--vscode-input-border);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        padding: 10px 12px;
        font: inherit;
      }

      textarea {
        min-height: 108px;
        resize: vertical;
      }

      button {
        border: 0;
        border-radius: 8px;
        padding: 8px 12px;
        font: inherit;
        cursor: pointer;
      }

      .primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }

      .secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }

      button:disabled {
        opacity: 0.6;
        cursor: default;
      }

      .error {
        color: var(--vscode-errorForeground);
      }

      .empty {
        color: var(--vscode-descriptionForeground);
        font-style: italic;
      }

      .list {
        margin: 0;
        padding-left: 18px;
        display: grid;
        gap: 6px;
      }

      .transcript {
        display: grid;
        gap: 10px;
        max-height: 360px;
        overflow-y: auto;
      }

      .bubble {
        display: grid;
        gap: 6px;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid var(--vscode-panel-border);
        white-space: pre-wrap;
      }

      .bubble-role {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .bubble-user {
        background: color-mix(in srgb, var(--vscode-button-background) 14%, transparent);
      }

      .bubble-assistant {
        background: color-mix(in srgb, var(--vscode-editor-background) 80%, transparent);
      }

      .bubble-system {
        background: color-mix(in srgb, var(--vscode-badge-background) 18%, transparent);
      }

      .edit-list {
        display: grid;
        gap: 10px;
      }

      .edit-item {
        display: grid;
        gap: 4px;
        padding: 10px;
        border-radius: 8px;
        border: 1px solid var(--vscode-panel-border);
      }

      .edit-head {
        display: flex;
        gap: 8px;
        align-items: flex-start;
      }

      .edit-actions {
        display: flex;
        justify-content: flex-end;
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="card hero">
        <h1>Maglev Agent</h1>
        <p>Chat with the model like Codex, then promote the conversation into a concrete coding task when you are ready.</p>
        <div class="status-row">
          <span class="badge" id="phase-badge">Idle</span>
          <span class="badge" id="backend-badge">Checking backend</span>
        </div>
      </section>

      <section class="card section">
        <h2>Conversation</h2>
        <div id="transcript-content" class="empty">Conversation is empty.</div>
        <textarea id="chat-input" placeholder="Ask the agent a question or describe a coding task"></textarea>
        <div class="actions">
          <button id="ask-button" class="secondary">Ask Agent</button>
          <button id="run-button" class="primary">Run Task</button>
          <button id="refresh-button" class="secondary">Refresh Status</button>
        </div>
        <p id="info-message" class="muted">Ready to start a conversation.</p>
        <p id="error-message" class="error"></p>
      </section>

      <section class="card section">
        <h2>Backend</h2>
        <div id="backend-content" class="kv empty">No backend status yet.</div>
      </section>

      <section class="card section">
        <h2>Latest Run</h2>
        <div id="run-content" class="empty">No runs yet.</div>
      </section>

      <section class="card section">
        <h2>Edit Review</h2>
        <div id="edit-content" class="empty">Start a task to review proposed edits.</div>
        <div class="actions">
          <button id="apply-edits-button" class="primary">Apply Selected Edits</button>
          <button id="run-checks-button" class="secondary">Run Checks</button>
        </div>
      </section>

      <section class="card section">
        <h2>Commit</h2>
        <input id="commit-title" type="text" placeholder="Commit title" />
        <textarea id="commit-body" placeholder="Commit body (optional)"></textarea>
        <div class="actions">
          <button id="prepare-commit-button" class="secondary">Prepare Commit Message</button>
          <button id="commit-button" class="primary">Commit</button>
          <button id="push-button" class="secondary">Push</button>
        </div>
      </section>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const chatInput = document.getElementById('chat-input');
      const askButton = document.getElementById('ask-button');
      const runButton = document.getElementById('run-button');
      const refreshButton = document.getElementById('refresh-button');
      const phaseBadge = document.getElementById('phase-badge');
      const backendBadge = document.getElementById('backend-badge');
      const infoMessage = document.getElementById('info-message');
      const errorMessage = document.getElementById('error-message');
      const transcriptContent = document.getElementById('transcript-content');
      const backendContent = document.getElementById('backend-content');
      const runContent = document.getElementById('run-content');
      const editContent = document.getElementById('edit-content');
      const applyEditsButton = document.getElementById('apply-edits-button');
      const runChecksButton = document.getElementById('run-checks-button');
      const commitTitle = document.getElementById('commit-title');
      const commitBody = document.getElementById('commit-body');
      const prepareCommitButton = document.getElementById('prepare-commit-button');
      const commitButton = document.getElementById('commit-button');
      const pushButton = document.getElementById('push-button');

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function renderTranscript(transcript) {
        if (!transcript?.length) {
          transcriptContent.className = 'empty';
          transcriptContent.textContent = 'Conversation is empty.';
          return;
        }

        transcriptContent.className = 'transcript';
        transcriptContent.innerHTML = transcript.map((item) => \`
          <div class="bubble bubble-\${escapeHtml(item.role)}">
            <div class="bubble-role">\${escapeHtml(item.role)}</div>
            <div>\${escapeHtml(item.text)}</div>
          </div>
        \`).join('');
        transcriptContent.scrollTop = transcriptContent.scrollHeight;
      }

      function renderBackend(backend) {
        if (!backend) {
          backendContent.className = 'empty';
          backendContent.textContent = 'No backend status yet.';
          backendBadge.textContent = 'Backend unknown';
          return;
        }

        backendBadge.textContent = backend.model
          ? \`\${backend.model} @ \${backend.endpoint}\`
          : backend.endpoint;
        backendContent.className = 'kv';
        backendContent.innerHTML = [
          \`<div><strong>Endpoint:</strong> \${escapeHtml(backend.endpoint)}</div>\`,
          backend.model ? \`<div><strong>Selected model:</strong> \${escapeHtml(backend.model)}</div>\` : '',
          backend.availableModels?.length
            ? \`<div><strong>Available:</strong> \${escapeHtml(backend.availableModels.join(', '))}</div>\`
            : '',
          \`<div><strong>Status:</strong> \${escapeHtml(backend.message)}</div>\`,
        ].filter(Boolean).join('');
      }

      function renderRun(run) {
        if (!run) {
          runContent.className = 'empty';
          runContent.textContent = 'No runs yet.';
          return;
        }

        const steps = run.steps?.length
          ? \`<ul class="list">\${run.steps.map((step) => \`<li>\${escapeHtml(step.title)}\${step.approval ? ' [approval]' : ''}</li>\`).join('')}</ul>\`
          : '<div class="empty">No plan steps.</div>';

        runContent.className = 'section';
        runContent.innerHTML = [
          \`<div><strong>Run:</strong> \${escapeHtml(run.runId)}</div>\`,
          \`<div><strong>Status:</strong> \${escapeHtml(run.status)}</div>\`,
          \`<div><strong>Task:</strong> \${escapeHtml(run.task)}</div>\`,
          \`<div><strong>Summary:</strong> \${escapeHtml(run.summary)}</div>\`,
          \`<div><strong>Plan:</strong> \${escapeHtml(String(run.stepCount))} step(s)</div>\`,
          \`<div><strong>Edits:</strong> proposed \${escapeHtml(String(run.proposedEditCount))}, applied \${escapeHtml(String(run.appliedEditCount))}</div>\`,
          run.commitTitle ? \`<div><strong>Commit title:</strong> \${escapeHtml(run.commitTitle)}</div>\` : '',
          run.commitHash ? \`<div><strong>Commit hash:</strong> \${escapeHtml(run.commitHash)}</div>\` : '',
          run.deployHost ? \`<div><strong>Deploy:</strong> \${escapeHtml(run.deployHost)} (\${escapeHtml(run.deployHealth ?? 'unknown')})</div>\` : '',
          '<h3>Steps</h3>',
          steps,
        ].filter(Boolean).join('');
      }

      function renderEdits(run) {
        if (!run || !run.edits?.length) {
          editContent.className = 'empty';
          editContent.textContent = 'No proposed edits for the current run.';
          return;
        }

        editContent.className = 'edit-list';
        editContent.innerHTML = run.edits.map((edit) => \`
          <div class="edit-item">
            <div class="edit-head">
              <label>
                <input type="checkbox" data-edit-path="\${escapeHtml(edit.path)}" \${edit.selected ? 'checked' : ''} />
              </label>
              <strong>\${escapeHtml(edit.path)}</strong>
            </div>
            <div class="edit-summary">\${escapeHtml(edit.summary)}</div>
            <div class="edit-actions">
              <button type="button" class="secondary" data-open-diff-path="\${escapeHtml(edit.path)}">Open Diff</button>
            </div>
          </div>
        \`).join('');

        editContent.querySelectorAll('input[data-edit-path]').forEach((input) => {
          input.addEventListener('change', (event) => {
            const target = event.target;
            vscode.postMessage({
              type: 'toggleEdit',
              path: target.getAttribute('data-edit-path'),
              selected: target.checked,
            });
          });
        });

        editContent.querySelectorAll('button[data-open-diff-path]').forEach((button) => {
          button.addEventListener('click', (event) => {
            const target = event.target;
            vscode.postMessage({
              type: 'openEditPreview',
              path: target.getAttribute('data-open-diff-path'),
            });
          });
        });
      }

      function setBusy(isBusy) {
        chatInput.disabled = isBusy;
        askButton.disabled = isBusy;
        runButton.disabled = isBusy;
        refreshButton.disabled = isBusy;
        applyEditsButton.disabled = isBusy;
        runChecksButton.disabled = isBusy;
        commitTitle.disabled = isBusy;
        commitBody.disabled = isBusy;
        prepareCommitButton.disabled = isBusy;
        commitButton.disabled = isBusy;
        pushButton.disabled = isBusy;
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type !== 'state') {
          return;
        }

        const state = message.payload;
        if (document.activeElement !== chatInput) {
          chatInput.value = state.chatDraft ?? '';
        }
        if (document.activeElement !== commitTitle) {
          commitTitle.value = state.commitDraft?.title ?? '';
        }
        if (document.activeElement !== commitBody) {
          commitBody.value = state.commitDraft?.body ?? '';
        }

        phaseBadge.textContent = state.phase || 'Idle';
        infoMessage.textContent = state.infoMessage || '';
        errorMessage.textContent = state.errorMessage || '';
        setBusy(Boolean(state.isBusy));
        renderTranscript(state.transcript);
        renderBackend(state.backendStatus);
        renderRun(state.latestRun);
        renderEdits(state.latestRun);

        askButton.disabled = !state.actions?.canAskAgent;
        runButton.disabled = !state.actions?.canRunTask;
        applyEditsButton.disabled = !state.actions?.canApplyEdits;
        runChecksButton.disabled = !state.actions?.canRunChecks;
        prepareCommitButton.disabled = !state.actions?.canPrepareCommit;
        commitButton.disabled = !state.actions?.canCommit;
        pushButton.disabled = !state.actions?.canPush;
      });

      chatInput.addEventListener('input', () => {
        vscode.postMessage({ type: 'chatDraftChanged', task: chatInput.value });
      });

      askButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'askAgent', task: chatInput.value });
      });

      runButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'runTask', task: chatInput.value });
      });

      refreshButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'refresh' });
      });

      applyEditsButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'applySelectedEdits' });
      });

      runChecksButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'runChecks' });
      });

      prepareCommitButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'prepareCommit' });
      });

      function syncCommitDraft() {
        vscode.postMessage({
          type: 'commitDraftChanged',
          title: commitTitle.value,
          body: commitBody.value,
        });
      }

      commitTitle.addEventListener('input', syncCommitDraft);
      commitBody.addEventListener('input', syncCommitDraft);

      commitButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'commit' });
      });

      pushButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'push' });
      });

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }
}
