/** Keep every model-written file inside the same network-disabled Docker sandbox. */
export function isolatedTaskEffects(sandbox) {
  return {
    workspaceEffects: async (request) => {
      const effect = await request.json();
      return Response.json(
        effect.kind === "execute"
          ? await sandbox.command(
              effect.files,
              effect.command.kind,
              effect.command.paths,
            )
          : {},
      );
    },
    nodeEffect: async (request) => {
      const { bundle, invocation } = await request.json();
      if (bundle.dependencies.length)
        return Response.json({ ok: false, code: "runtime_unavailable" });
      try {
        return Response.json({
          ok: true,
          value: await sandbox.execute(
            bundle.files,
            bundle.entrypoint,
            invocation,
          ),
        });
      } catch {
        return Response.json({ ok: false, code: "execution_failed" });
      }
    },
  };
}
