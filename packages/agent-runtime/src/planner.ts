import { RepositoryContext, TaskPlanResponse } from '@ai-cvsc/contracts';
import { AgentGateway } from '@ai-cvsc/gateway-client';

export class Planner {
  constructor(private readonly gatewayClient: AgentGateway) {}

  async createPlan(runId: string, task: string, repository: RepositoryContext): Promise<TaskPlanResponse> {
    return this.gatewayClient.createTaskPlan(runId, task, repository);
  }
}
