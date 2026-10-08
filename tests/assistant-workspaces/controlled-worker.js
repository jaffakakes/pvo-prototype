// Controlled Container effects for real workerd storage and RPC tests; never a native provider proof.
import { AssistantWorkspace } from "../../server/assistant/workspaces/coordinator.js";
import { WorkspaceBudget } from "../../server/assistant/workspaces/budget.js";
export class TestBudget extends WorkspaceBudget {
  now() {
    return (
      this.clock ??
      (this.env.CONTROLLED_PLAN ? Date.now() : Date.UTC(2100, 0, 1))
    );
  }
  setTime(now) {
    this.clock = now;
  }
  async sweep() {
    await this.alarm();
    return true;
  }
  inspect() {
    return this.ctx.storage.sql
      .exec("SELECT body,released FROM workspace_grants")
      .toArray()
      .map((row) => ({ ...JSON.parse(row.body), released: !!row.released }));
  }
}
export class TestWorkspace extends AssistantWorkspace {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS fake_vm (id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
    );
  }
  now() {
    return (
      this.clock ??
      (this.env.CONTROLLED_PLAN ? Date.now() : Date.UTC(2100, 0, 1))
    );
  }
  setTime(now) {
    this.clock = now;
  }
  async sweep() {
    await this.alarm();
    return true;
  }
  crash() {
    this.ctx.abort("Controlled workspace restart");
  }
  effectTimeoutMs() {
    return 150;
  }
  vm() {
    return JSON.parse(
      this.ctx.storage.sql
        .exec("SELECT body FROM fake_vm WHERE id=1")
        .toArray()[0]?.body ??
        '{"running":false,"starts":0,"destroys":0,"executions":0}',
    );
  }
  saveVM(vm) {
    this.ctx.storage.sql.exec(
      "INSERT INTO fake_vm (id,body) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      JSON.stringify(vm),
    );
  }
  provider() {
    const control = async (kind, details = {}) => {
      const result = await (
        await this.env.CONTROL.fetch("https://control.test/", {
          method: "POST",
          body: JSON.stringify({
            kind,
            ...details,
            resourceId: this.journal.state()?.identity.resourceId,
          }),
        })
      ).json();
      if (result.fail) throw new Error("Controlled provider failure");
      return result;
    };
    return {
      absent: async () => !this.vm().running,
      start: () => {
        const vm = this.vm();
        if (vm.running) throw new Error("Duplicate VM");
        this.saveVM({
          ...vm,
          running: true,
          starts: vm.starts + 1,
          files: null,
        });
      },
      restore: async (snapshot, assertCurrent) => {
        await control("restore");
        assertCurrent();
        const vm = this.vm();
        if (!vm.running) throw new Error("VM stopped");
        this.saveVM({ ...vm, files: snapshot.files });
      },
      execute: async (command) => {
        const vm = this.vm();
        if (!vm.running) throw new Error("VM stopped");
        this.saveVM({ ...vm, executions: vm.executions + 1 });
        const result = await control("execute", { command, files: vm.files });
        return {
          stdout: result.stdout ?? "ok",
          stderr: "",
          exitCode: result.exitCode ?? 0,
        };
      },
      destroy: async () => {
        await control("destroy");
        const vm = this.vm();
        this.saveVM({
          ...vm,
          running: false,
          destroys: vm.destroys + 1,
          files: null,
        });
      },
    };
  }
  inspect() {
    return {
      state: this.journal.state(),
      vm: this.vm(),
      actions: this.ctx.storage.sql
        .exec("SELECT body FROM workspace_actions")
        .toArray()
        .map((row) => JSON.parse(row.body)),
    };
  }
}
