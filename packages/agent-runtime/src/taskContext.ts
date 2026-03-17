import { RepositoryContext } from '@ai-cvsc/contracts';
import { GitExecutor } from '@ai-cvsc/execution';

export async function buildRepositoryContext(workspaceRoot: string, gitExecutor: GitExecutor): Promise<RepositoryContext> {
  return {
    rootPath: workspaceRoot,
    branch: await gitExecutor.currentBranch(),
    changedFiles: await gitExecutor.changedFiles(),
  };
}
