import { ProductTasks } from "../node-product/tasks.js";
import { AssistantTasks } from "../../../server/assistant/tasks/coordinator.js";
import { checkConnectedArtifact } from "./artifact.js";

/** Uses the product task, real independent checks and host; only the diagnostic artifact is fixed. */
export class ConnectedTasks extends ProductTasks {
  checkArtifact(scope) {
    return checkConnectedArtifact(this.env.SERVICE_NODE_EXECUTION, scope);
  }
  serviceProvider() {
    return AssistantTasks.prototype.serviceProvider.call(this);
  }
}
