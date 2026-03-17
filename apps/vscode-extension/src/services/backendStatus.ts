import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { ExtensionSettings } from '../config/settings';

export interface BackendStatus {
  ok: boolean;
  endpoint: string;
  backendMode: string;
  configuredModel: string;
  availableModels: string[];
  message: string;
}

interface OpenAiModelsResponse {
  data?: Array<{ id?: string }>;
}

function buildStatusUrl(settings: ExtensionSettings): URL {
  const normalizedBase = settings.apiBaseUrl.replace(/\/+$/, '');
  if (settings.backendMode === 'openai_compat') {
    return new URL(`${normalizedBase}/models`);
  }

  return new URL(`${normalizedBase}/health`);
}

function getTransport(url: URL) {
  return url.protocol === 'https:' ? https : http;
}

function requestJson<T>(url: URL, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const transport = getTransport(url);
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        method: 'GET',
        path: `${url.pathname}${url.search}`,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`HTTP ${response.statusCode}: ${raw}`));
            return;
          }

          try {
            resolve(JSON.parse(raw) as T);
          } catch (error) {
            reject(new Error(`Invalid JSON from backend status endpoint: ${(error as Error).message}`));
          }
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error(`Backend status request timed out after ${timeoutMs}ms`));
    });
    request.on('error', reject);
    request.end();
  });
}

export async function getBackendStatus(settings: ExtensionSettings): Promise<BackendStatus> {
  const statusUrl = buildStatusUrl(settings);
  const backendMode = settings.backendMode ?? 'openai_compat';

  if (backendMode === 'openai_compat') {
    const response = await requestJson<OpenAiModelsResponse>(statusUrl, settings.requestTimeoutMs);
    const availableModels = (response.data ?? [])
      .map((model) => model.id?.trim())
      .filter((model): model is string => Boolean(model));
    const modelAvailable = availableModels.includes(settings.model);

    return {
      ok: true,
      endpoint: statusUrl.toString(),
      backendMode,
      configuredModel: settings.model,
      availableModels,
      message: modelAvailable
        ? `Backend reachable. Model ${settings.model} is available.`
        : `Backend reachable, but model ${settings.model} was not returned by /models.`,
    };
  }

  await requestJson<Record<string, unknown>>(statusUrl, settings.requestTimeoutMs);
  return {
    ok: true,
    endpoint: statusUrl.toString(),
    backendMode,
    configuredModel: settings.model,
    availableModels: [],
    message: 'Secure gateway reachable.',
  };
}
