import { DeployRequestProposal, DeployResult } from '@ai-cvsc/contracts';
import { ShellExecutor } from './shellExecutor';

export interface DeployCommandPreview {
  host: string;
  sshCommand: string;
  remoteCommand: string;
}

function buildRemoteCommand(request: DeployRequestProposal): string {
  const commands = [
    `cd ${request.repoPath}`,
    `git pull origin ${request.branch}`,
  ];

  if (request.restartCommand) {
    commands.push(request.restartCommand);
  }

  return commands.join(' && ');
}

export class DeployExecutor {
  constructor(private readonly shellExecutor: ShellExecutor) {}

  preview(request: DeployRequestProposal): DeployCommandPreview {
    return {
      host: request.host,
      sshCommand: `ssh ${request.host}`,
      remoteCommand: buildRemoteCommand(request),
    };
  }

  async deploy(request: DeployRequestProposal): Promise<DeployResult> {
    const remoteCommand = buildRemoteCommand(request);
    const result = await this.shellExecutor.run('ssh', [request.host, remoteCommand], process.cwd());
    return {
      success: result.exitCode === 0,
      host: request.host,
      branch: request.branch,
      health: result.exitCode === 0 ? 'ok' : 'failed',
      logs: [result.stdout, result.stderr].filter(Boolean),
    };
  }
}
