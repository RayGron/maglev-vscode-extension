import { ActionKind } from '@ai-cvsc/contracts';

export class PolicyGuard {
  assertAllowed(action: ActionKind, approved: boolean): void {
    const needsApproval = action === 'write_file' || action === 'run_checks' || action === 'git_commit' || action === 'git_push' || action === 'remote_deploy';
    if (needsApproval && !approved) {
      throw new Error(`Action ${action} requires explicit local approval.`);
    }
  }
}
