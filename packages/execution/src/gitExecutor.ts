import path from 'node:path';
import { ShellExecutor } from './shellExecutor';

export class GitExecutor {
  constructor(
    private readonly shellExecutor: ShellExecutor,
    private readonly workspaceRoot: string,
  ) {}

  async currentBranch(): Promise<string> {
    const result = await this.shellExecutor.run('git', ['branch', '--show-current'], this.workspaceRoot);
    return result.stdout.trim() || 'unknown';
  }

  async changedFiles(): Promise<string[]> {
    const result = await this.shellExecutor.run('git', ['status', '--short'], this.workspaceRoot);
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.slice(3).trim());
  }

  async diffSummary(): Promise<string> {
    const result = await this.shellExecutor.run('git', ['diff', '--stat'], this.workspaceRoot);
    return result.stdout.trim();
  }

  async commitAll(title: string, body?: string): Promise<string> {
    await this.shellExecutor.run('git', ['add', '.'], this.workspaceRoot);
    const args = body ? ['commit', '-m', title, '-m', body] : ['commit', '-m', title];
    const result = await this.shellExecutor.run('git', args, this.workspaceRoot);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || 'git commit failed');
    }

    const rev = await this.shellExecutor.run('git', ['rev-parse', 'HEAD'], this.workspaceRoot);
    return rev.stdout.trim();
  }

  async pushCurrentBranch(): Promise<void> {
    const branch = await this.currentBranch();
    const result = await this.shellExecutor.run('git', ['push', 'origin', branch], this.workspaceRoot);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || 'git push failed');
    }
  }

  resolveInRepo(relativePath: string): string {
    return path.join(this.workspaceRoot, relativePath);
  }
}
