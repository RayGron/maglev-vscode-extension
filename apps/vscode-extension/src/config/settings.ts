import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as vscode from 'vscode';
import { GatewayClientConfig } from '@ai-cvsc/gateway-client';

function expandHome(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }

  if (input === '~') {
    return os.homedir();
  }

  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
}

export interface ExtensionSettings extends GatewayClientConfig {
  workspaceRoot: string;
}

interface RuntimeConfigDefaults {
  apiBaseUrl?: string;
  model?: string;
  requestTimeoutMs?: number;
  jsonResponseProfile?: {
    temperature?: number;
    maxTokens?: number[];
  };
}

interface RuntimeConfigFile {
  defaultBackendMode?: 'openai_compat' | 'secure_gateway';
  openaiCompat?: RuntimeConfigDefaults;
  secureGateway?: RuntimeConfigDefaults;
}

function readRuntimeConfigFile(workspaceRoot: string, configPathValue: string | undefined): RuntimeConfigFile {
  const resolvedPath = resolveRuntimeConfigPath(workspaceRoot, configPathValue);
  if (!resolvedPath) {
    return {};
  }

  try {
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    return JSON.parse(raw) as RuntimeConfigFile;
  } catch {
    return {};
  }
}

function resolveRuntimeConfigPath(workspaceRoot: string, input: string | undefined): string | undefined {
  const expanded = expandHome(input?.trim());
  if (!expanded) {
    return undefined;
  }

  if (path.isAbsolute(expanded)) {
    return expanded;
  }

  return path.join(workspaceRoot, expanded);
}

function pickBackendDefaults(
  runtimeConfig: RuntimeConfigFile,
  backendMode: GatewayClientConfig['backendMode'],
): RuntimeConfigDefaults {
  return backendMode === 'secure_gateway'
    ? (runtimeConfig.secureGateway ?? {})
    : (runtimeConfig.openaiCompat ?? {});
}

export function getExtensionSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration('aiCvsc');
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const runtimeConfigPath = String(config.get('runtimeConfigPath') ?? 'config/model-endpoints.json');
  const runtimeConfig = readRuntimeConfigFile(workspaceRoot, runtimeConfigPath);
  const backendMode = String(config.get('backendMode') ?? runtimeConfig.defaultBackendMode ?? 'openai_compat') as GatewayClientConfig['backendMode'];
  const backendDefaults = pickBackendDefaults(runtimeConfig, backendMode);
  const apiBaseUrlOverride = String(config.get('apiBaseUrl') ?? '').trim();
  const modelOverride = String(config.get('model') ?? '').trim();

  return {
    workspaceRoot,
    backendMode,
    apiBaseUrl: apiBaseUrlOverride || backendDefaults.apiBaseUrl || 'http://127.0.0.1:1234/v1',
    model: modelOverride || backendDefaults.model || 'qwen/qwen3.5-35b-a3b',
    requestTimeoutMs: backendDefaults.requestTimeoutMs ?? 30000,
    openAiCompatProfile: backendDefaults.jsonResponseProfile,
    privateKeyPath: expandHome(String(config.get('privateKeyPath') ?? '')) ?? path.join(os.homedir(), '.ai-cvsc', 'id_ed25519'),
    publicKeyPath: expandHome(String(config.get('publicKeyPath') ?? '')),
  };
}
