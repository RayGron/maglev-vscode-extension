import { DeployRequestProposal, EditProposal } from '@ai-cvsc/contracts';
import { DeployExecutor, FileExecutor, GitExecutor, PolicyGuard, ShellExecutor } from '@ai-cvsc/execution';

export class StepExecutor {
  constructor(
    private readonly fileExecutor: FileExecutor,
    private readonly shellExecutor: ShellExecutor,
    private readonly gitExecutor: GitExecutor,
    private readonly deployExecutor: DeployExecutor,
    private readonly policyGuard: PolicyGuard,
  ) {}

  async applyEdits(edits: EditProposal[], approved: boolean): Promise<void> {
    this.policyGuard.assertAllowed('write_file', approved);
    for (const edit of edits) {
      await this.fileExecutor.writeText(this.gitExecutor.resolveInRepo(edit.path), edit.content);
    }
  }

  async runChecks(approved: boolean): Promise<void> {
    this.policyGuard.assertAllowed('run_checks', approved);
    const result = await this.shellExecutor.run('npm', ['run', 'check'], this.gitExecutor.resolveInRepo('.'));
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || 'Local checks failed');
    }
  }

  async commit(title: string, body: string | undefined, approved: boolean): Promise<string> {
    this.policyGuard.assertAllowed('git_commit', approved);
    return this.gitExecutor.commitAll(title, body);
  }

  async push(approved: boolean): Promise<void> {
    this.policyGuard.assertAllowed('git_push', approved);
    await this.gitExecutor.pushCurrentBranch();
  }

  async deploy(request: DeployRequestProposal, approved: boolean) {
    this.policyGuard.assertAllowed('remote_deploy', approved);
    return this.deployExecutor.deploy(request);
  }
}
