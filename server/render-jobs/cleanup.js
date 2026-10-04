export async function cleanupRenders(env, now = Date.now()) {
  // The current deployed D1 may not have the render migration while the
  // feature flag is off; publishing cleanup must keep working independently.
  if (env.RENDERING_ENABLED !== "true" || !env.DB || !env.MEDIA) return;
  await env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = ?, progress = 0
    WHERE status = 'rendering' AND updated_at < ?`)
    .bind("The server render timed out. Please retry or use browser export.", now - 20 * 60 * 1000).run();
  const { results } = await env.DB.prepare(`SELECT id, result_key FROM render_jobs
    WHERE status = 'cancelled' OR expires_at <= ? LIMIT 100`).bind(now).all();
  for (const job of results) {
    const { results: assets } = await env.DB.prepare("SELECT object_key FROM render_assets WHERE job_id = ?")
      .bind(job.id).all();
    for (const asset of assets) await env.MEDIA.delete(asset.object_key);
    if (job.result_key) await env.MEDIA.delete(job.result_key);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM render_assets WHERE job_id = ?").bind(job.id),
      env.DB.prepare("DELETE FROM render_jobs WHERE id = ?").bind(job.id),
    ]);
  }
}
