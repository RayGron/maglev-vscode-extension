import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { buildCanonicalRequest, KeyManager, signCanonicalRequest } from '@ai-cvsc/auth';
import {
  AgentTaskRequest,
  CommitMessageProposal,
  DeployRequestProposal,
  EditProposal,
  InlineCompletionRequest,
  InlineCompletionResponse,
  RepositoryContext,
  TaskPlanResponse,
  TerminalReply,
} from '@ai-cvsc/contracts';

export interface GatewayClientConfig {
  backendMode?: "secure_gateway" | "openai_compat";
  apiBaseUrl: string;
  model: string;
  requestTimeoutMs: number;
  openAiCompatProfile?: {
    temperature?: number;
    maxTokens?: number[];
  };
  privateKeyPath: string;
  publicKeyPath?: string;
}

export interface AgentGateway {
  requestInlineCompletion(runId: string, input: InlineCompletionRequest): Promise<InlineCompletionResponse>;
  createTaskPlan(runId: string, task: string, repository: RepositoryContext): Promise<TaskPlanResponse>;
  requestEdits(runId: string, task: string, repository: RepositoryContext): Promise<EditProposal[]>;
  requestCommitMessage(runId: string, task: string, diffSummary: string): Promise<CommitMessageProposal>;
  requestDeploy(runId: string, instruction: string, repository: RepositoryContext): Promise<DeployRequestProposal>;
  terminalReply(runId: string, task: string, details: Record<string, unknown>): Promise<TerminalReply>;
}

export class GatewayClient implements AgentGateway {
  constructor(
    private readonly config: GatewayClientConfig,
    private readonly keyManager: KeyManager,
  ) {}

  async requestInlineCompletion(runId: string, input: InlineCompletionRequest): Promise<InlineCompletionResponse> {
    return this.post<InlineCompletionResponse>('/agent/inline-completion', {
      mode: 'inline_completion',
      runId,
      task: 'Provide the next code continuation.',
      context: input,
      metadata: { model: this.config.model },
    });
  }

  async createTaskPlan(runId: string, task: string, repository: RepositoryContext): Promise<TaskPlanResponse> {
    return this.post<TaskPlanResponse>('/agent/plan', {
      mode: 'task_plan',
      runId,
      task,
      context: repository,
      metadata: { model: this.config.model },
    });
  }

  async requestEdits(runId: string, task: string, repository: RepositoryContext): Promise<EditProposal[]> {
    return this.post<EditProposal[]>('/agent/edits', {
      mode: 'edit_patch',
      runId,
      task,
      context: repository,
      metadata: { model: this.config.model },
    });
  }

  async requestCommitMessage(runId: string, task: string, diffSummary: string): Promise<CommitMessageProposal> {
    return this.post<CommitMessageProposal>('/agent/commit-message', {
      mode: 'commit_message',
      runId,
      task,
      context: { diffSummary },
      metadata: { model: this.config.model },
    });
  }

  async requestDeploy(runId: string, instruction: string, repository: RepositoryContext): Promise<DeployRequestProposal> {
    return this.post<DeployRequestProposal>('/agent/deploy-request', {
      mode: 'deploy_request',
      runId,
      task: instruction,
      context: repository,
      metadata: { model: this.config.model },
    });
  }

  async terminalReply(runId: string, task: string, details: Record<string, unknown>): Promise<TerminalReply> {
    return this.post<TerminalReply>('/agent/terminal-reply', {
      mode: 'terminal_reply',
      runId,
      task,
      context: details,
      metadata: { model: this.config.model },
    });
  }

  private async post<T>(pathname: string, payload: AgentTaskRequest): Promise<T> {
    const url = new URL(pathname, this.config.apiBaseUrl);
    const body = JSON.stringify(payload);
    const identity = await this.keyManager.loadIdentity(this.config.privateKeyPath, this.config.publicKeyPath);
    const timestamp = Date.now();
    const nonce = `${timestamp}-${Math.random().toString(36).slice(2)}`;
    const canonicalRequest = buildCanonicalRequest('POST', url.pathname, timestamp, nonce, identity.keyId, body);
    const signature = signCanonicalRequest(identity.privateKey, canonicalRequest);

    return new Promise<T>((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const request = transport.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          method: 'POST',
          path: `${url.pathname}${url.search}`,
          timeout: this.config.requestTimeoutMs,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            'x-ai-cvsc-key-id': identity.keyId,
            'x-ai-cvsc-timestamp': String(timestamp),
            'x-ai-cvsc-nonce': nonce,
            'x-ai-cvsc-signature': signature,
            'x-ai-cvsc-public-key': identity.publicKeyPayload,
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if ((response.statusCode ?? 500) >= 400) {
              reject(new Error(`Gateway request failed with ${response.statusCode}: ${raw}`));
              return;
            }

            try {
              resolve(JSON.parse(raw) as T);
            } catch (error) {
              reject(new Error(`Gateway returned invalid JSON: ${(error as Error).message}`));
            }
          });
        },
      );

      request.on('timeout', () => {
        request.destroy(new Error(`Gateway request timed out after ${this.config.requestTimeoutMs}ms`));
      });
      request.on('error', reject);
      request.write(body);
      request.end();
    });
  }
}

function systemPromptForMode(mode: AgentTaskRequest["mode"]): string {
  switch (mode) {
    case "inline_completion":
      return 'Return JSON only. Schema: {"content":string}. Continue the code naturally. Do not include markdown fences.';
    case "task_plan":
      return 'Return JSON only. Schema: {"summary":string,"steps":[{"id":string,"title":string,"kind":string,"requiresApproval":boolean}]}.';
    case "edit_patch":
      return 'Return JSON only. Schema: [{"path":string,"content":string,"summary":string}].';
    case "commit_message":
      return 'Return JSON only. Schema: {"title":string,"body":string|null}.';
    case "deploy_request":
      return 'Return JSON only. Schema: {"host":string,"repoPath":string,"branch":string,"restartCommand":string|null}.';
    case "terminal_reply":
      return 'Return JSON only. Schema: {"message":string}.';
    default:
      return 'Return JSON only.';
  }
}

interface OpenAiCompatibleMessage {
  content?: string;
  reasoning_content?: string;
}

interface OpenAiCompatibleChoice {
  message?: OpenAiCompatibleMessage;
  finish_reason?: string;
}

interface OpenAiCompatibleResponse {
  choices?: OpenAiCompatibleChoice[];
}

function extractJsonCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const direct = extractJsonText(trimmed);
  if (direct) {
    return direct;
  }

  return null;
}

function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith("```")) {
    const withoutPrefix = trimmed.replace(/^```(?:json)?\s*/i, "");
    return withoutPrefix.replace(/\s*```$/, "").trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }

  return trimmed;
}

function decodeOpenAiJsonResponse<T>(response: OpenAiCompatibleResponse): T {
  const choice = response.choices?.[0];
  const content = choice?.message?.content;
  const reasoning = choice?.message?.reasoning_content;
  const candidates = [content, reasoning]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => extractJsonCandidate(value))
    .filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }

  const finishReason = choice?.finish_reason ?? 'unknown';
  throw new Error(`OpenAI-compatible response did not contain valid JSON in content or reasoning_content (finish_reason: ${finishReason})`);
}

function normalizeTokenBudgets(config: GatewayClientConfig): number[] {
  const configured = config.openAiCompatProfile?.maxTokens
    ?.filter((value): value is number => Number.isFinite(value) && value > 0)
    .map((value) => Math.floor(value));
  if (configured && configured.length > 0) {
    return [...new Set(configured)];
  }

  return [512, 1024];
}

function normalizeTemperature(config: GatewayClientConfig): number {
  const configured = config.openAiCompatProfile?.temperature;
  if (typeof configured === 'number' && Number.isFinite(configured) && configured >= 0) {
    return configured;
  }

  return 0.2;
}

export class OpenAICompatibleGatewayClient implements AgentGateway {
  constructor(private readonly config: GatewayClientConfig) {}

  async requestInlineCompletion(runId: string, input: InlineCompletionRequest): Promise<InlineCompletionResponse> {
    return this.chatJson("/chat/completions", {
      mode: "inline_completion",
      runId,
      task: "Provide the next code continuation.",
      context: input,
      metadata: { model: this.config.model },
    });
  }

  async createTaskPlan(runId: string, task: string, repository: RepositoryContext): Promise<TaskPlanResponse> {
    return this.chatJson("/chat/completions", {
      mode: "task_plan",
      runId,
      task,
      context: repository,
      metadata: { model: this.config.model },
    });
  }

  async requestEdits(runId: string, task: string, repository: RepositoryContext): Promise<EditProposal[]> {
    return this.chatJson("/chat/completions", {
      mode: "edit_patch",
      runId,
      task,
      context: repository,
      metadata: { model: this.config.model },
    });
  }

  async requestCommitMessage(runId: string, task: string, diffSummary: string): Promise<CommitMessageProposal> {
    return this.chatJson("/chat/completions", {
      mode: "commit_message",
      runId,
      task,
      context: { diffSummary },
      metadata: { model: this.config.model },
    });
  }

  async requestDeploy(runId: string, instruction: string, repository: RepositoryContext): Promise<DeployRequestProposal> {
    return this.chatJson("/chat/completions", {
      mode: "deploy_request",
      runId,
      task: instruction,
      context: repository,
      metadata: { model: this.config.model },
    });
  }

  async terminalReply(runId: string, task: string, details: Record<string, unknown>): Promise<TerminalReply> {
    return this.chatJson("/chat/completions", {
      mode: "terminal_reply",
      runId,
      task,
      context: details,
      metadata: { model: this.config.model },
    });
  }

  private async chatJson<T>(pathname: string, payload: AgentTaskRequest): Promise<T> {
    const tokenBudgets = normalizeTokenBudgets(this.config);
    const temperature = normalizeTemperature(this.config);
    let lastError: Error | null = null;

    for (const maxTokens of tokenBudgets) {
      const response = await this.postOpenAi(pathname, {
        model: this.config.model,
        temperature,
        max_tokens: maxTokens,
        stream: false,
        messages: [
          {
            role: "system",
            content: systemPromptForMode(payload.mode),
          },
          {
            role: "user",
            content: JSON.stringify(payload, null, 2),
          },
        ],
      });

      try {
        return decodeOpenAiJsonResponse<T>(response as OpenAiCompatibleResponse);
      } catch (error) {
        lastError = error as Error;
        const finishReason = (response as OpenAiCompatibleResponse).choices?.[0]?.finish_reason;
        if (finishReason !== 'length') {
          break;
        }
      }
    }

    throw lastError ?? new Error('OpenAI-compatible response parsing failed');
  }

  private async postOpenAi(pathname: string, payload: Record<string, unknown>): Promise<any> {
    const url = new URL(`${this.config.apiBaseUrl.replace(/\/+$/, "")}${pathname}`);
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const transport = url.protocol === "https:" ? https : http;
      const request = transport.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          method: "POST",
          path: `${url.pathname}${url.search}`,
          timeout: this.config.requestTimeoutMs,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            if ((response.statusCode ?? 500) >= 400) {
              reject(new Error(`OpenAI-compatible request failed with ${response.statusCode}: ${raw}`));
              return;
            }

            try {
              resolve(JSON.parse(raw));
            } catch (error) {
              reject(new Error(`OpenAI-compatible endpoint returned invalid JSON: ${(error as Error).message}`));
            }
          });
        },
      );

      request.on("timeout", () => {
        request.destroy(new Error(`OpenAI-compatible request timed out after ${this.config.requestTimeoutMs}ms`));
      });
      request.on("error", reject);
      request.write(body);
      request.end();
    });
  }
}

export class MockGatewayClient implements AgentGateway {
  constructor(private readonly workspaceRoot: string) {}

  async requestInlineCompletion(_runId: string, input: InlineCompletionRequest): Promise<InlineCompletionResponse> {
    const linePrefix = input.prefix.split('\n').at(-1) ?? '';
    if (linePrefix.trim().endsWith('{')) {
      return { content: '\n  \n}' };
    }

    return { content: '' };
  }

  async createTaskPlan(_runId: string, task: string, repository: RepositoryContext): Promise<TaskPlanResponse> {
    return {
      summary: `Mock plan for task: ${task}`,
      steps: [
        { id: 'read', title: `Inspect repository ${repository.rootPath}`, kind: 'read', requiresApproval: false },
        { id: 'edit', title: 'Apply generated edits locally', kind: 'write_file', requiresApproval: true },
        { id: 'check', title: 'Run local checks', kind: 'run_checks', requiresApproval: true },
        { id: 'commit', title: 'Create commit', kind: 'git_commit', requiresApproval: true },
        { id: 'push', title: 'Push current branch', kind: 'git_push', requiresApproval: true },
      ],
    };
  }

  async requestEdits(_runId: string, task: string): Promise<EditProposal[]> {
    return [
      {
        path: 'ai-cvsc-output.md',
        summary: 'Write a local mock artifact for the requested task.',
        content: `# AI CVSC Mock Output\n\nTask: ${task}\n\nThis file was created by the local runtime using the mock gateway.\n`,
      },
    ];
  }

  async requestCommitMessage(): Promise<CommitMessageProposal> {
    return {
      title: 'chore: apply local AI CVSC changes',
      body: 'Generated by the local mock gateway flow.',
    };
  }

  async requestDeploy(_runId: string, instruction: string, repository: RepositoryContext): Promise<DeployRequestProposal> {
    const hostMatch = instruction.match(/\b(\d{1,3}(?:\.\d{1,3}){3}|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
    return {
      host: hostMatch?.[1] ?? 'example-host',
      repoPath: repository.rootPath,
      branch: repository.branch,
      restartCommand: 'echo "restart service here"',
    };
  }

  async terminalReply(_runId: string, task: string): Promise<TerminalReply> {
    return {
      message: `Mock gateway accepted task: ${task}`,
    };
  }
}

export function createAgentGateway(config: GatewayClientConfig, keyManager: KeyManager): AgentGateway {
  if (config.backendMode === "openai_compat") {
    return new OpenAICompatibleGatewayClient(config);
  }

  return new GatewayClient(config, keyManager);
}
