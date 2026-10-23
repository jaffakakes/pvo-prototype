export {
  default,
  WorkspaceProofBudget,
} from "../../scripts/checks/cloud-agent-workspaces/proof-worker.js";
import { WorkspaceProof } from "../../scripts/checks/cloud-agent-workspaces/proof-worker.js";

/** Tests the deployable control flow, with explicitly simulated Container effects. */
export class ControlledWorkspaceProof extends WorkspaceProof {
  rawProvider() {
    const sql = this.ctx.storage.sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS controlled_vm (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)",
    );
    const read = () =>
      JSON.parse(
        sql.exec("SELECT body FROM controlled_vm WHERE id=1").toArray()[0]
          ?.body ?? '{"running":false,"files":[]}',
      );
    const write = (value) =>
      sql.exec(
        "INSERT INTO controlled_vm (id,body) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
        JSON.stringify(value),
      );
    return {
      start() {
        if (read().running) throw new Error("Duplicate computer");
        write({ running: true, files: [] });
      },
      async restore(source, guard) {
        guard();
        write({ running: true, files: source.files });
      },
      async execute() {
        const vm = read();
        if (!vm.running) throw new Error("Computer stopped");
        const code = vm.files.find(
          (file) => file.path === "tests/service.test.mjs",
        ).content;
        if (code.includes("32768"))
          throw Object.assign(new Error("Controlled output overflow"), {
            code: "workspace_output_limit",
          });
        if (code.includes("spawn"))
          throw new Error("Controlled command deadline");
        return {
          stdout: "workspace fixture verified",
          stderr: "",
          exitCode: 0,
        };
      },
      async absent() {
        return !read().running;
      },
      async destroy() {
        write({ running: false, files: [] });
      },
    };
  }
}
