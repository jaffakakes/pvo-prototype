import { NODE_LIMITS } from "./runtime.js";

const DAY = 86400000;
const modes = ["live", "test", "validation", "probe"];
const empty = () => ({
  starts: 0,
  milliseconds: 0,
  startupMilliseconds: 0,
  executionMilliseconds: 0,
  cleanupMilliseconds: 0,
  admittedBytes: 0,
  resultBytes: 0,
});

/** Private compute accounting only; no source, inputs, results or service ownership catalog. */
export class NodeMetering {
  constructor(sql) {
    this.sql = sql;
    sql.exec(
      `CREATE TABLE IF NOT EXISTS node_usage(day INTEGER NOT NULL,owner_id TEXT NOT NULL,service_id TEXT NOT NULL,mode TEXT NOT NULL,starts INTEGER NOT NULL,milliseconds INTEGER NOT NULL,startup_ms INTEGER NOT NULL,execution_ms INTEGER NOT NULL,cleanup_ms INTEGER NOT NULL,admitted_bytes INTEGER NOT NULL,result_bytes INTEGER NOT NULL,PRIMARY KEY(day,owner_id,service_id,mode))`,
    );
  }
  counts(day, ownerId) {
    return {
      platform: this.sql
        .exec(
          "SELECT COALESCE(SUM(starts),0) AS count FROM node_usage WHERE day=?",
          day,
        )
        .one().count,
      owner: this.sql
        .exec(
          "SELECT COALESCE(SUM(starts),0) AS count FROM node_usage WHERE day=? AND owner_id=?",
          day,
          ownerId,
        )
        .one().count,
    };
  }
  reserve(lease, admittedBytes) {
    this.sql.exec(
      "INSERT INTO node_usage(day,owner_id,service_id,mode,starts,milliseconds,startup_ms,execution_ms,cleanup_ms,admitted_bytes,result_bytes) VALUES(?,?,?,?,1,0,0,0,0,?,0) ON CONFLICT(day,owner_id,service_id,mode) DO UPDATE SET starts=starts+1,admitted_bytes=admitted_bytes+excluded.admitted_bytes",
      lease.day,
      lease.ownerId,
      lease.serviceId,
      lease.mode,
      admittedBytes,
    );
  }
  settle(lease, now) {
    const end = Math.max(lease.startedAt, lease.finishedAt);
    const ready =
      lease.readyAt === null
        ? end
        : Math.max(lease.startedAt, Math.min(end, lease.readyAt));
    const cleanup = Math.max(0, now - end);
    this.sql.exec(
      "UPDATE node_usage SET milliseconds=milliseconds+?,startup_ms=startup_ms+?,execution_ms=execution_ms+?,cleanup_ms=cleanup_ms+?,result_bytes=result_bytes+? WHERE day=? AND owner_id=? AND service_id=? AND mode=?",
      end - lease.startedAt + cleanup,
      ready - lease.startedAt,
      end - ready,
      cleanup,
      lease.resultBytes,
      lease.day,
      lease.ownerId,
      lease.serviceId,
      lease.mode,
    );
  }
  snapshot(ownerId, serviceId, limits, lease, now) {
    const day = Math.floor(now / DAY);
    const counts = this.counts(day, ownerId);
    const rows = this.sql
      .exec(
        "SELECT * FROM node_usage WHERE owner_id=? AND service_id=?",
        ownerId,
        serviceId,
      )
      .toArray();
    const periods = Object.fromEntries(modes.map((mode) => [mode, empty()]));
    for (const row of rows) {
      const total = periods[row.mode];
      total.starts += row.starts;
      total.milliseconds += row.milliseconds;
      total.startupMilliseconds += row.startup_ms;
      total.executionMilliseconds += row.execution_ms;
      total.cleanupMilliseconds += row.cleanup_ms;
      total.admittedBytes += row.admitted_bytes;
      total.resultBytes += row.result_bytes;
    }
    const owned = lease?.ownerId === ownerId && lease.serviceId === serviceId;
    return {
      ownerId,
      serviceId,
      observedAt: now,
      periodStartAt: Math.min(day - 30, ...rows.map((row) => row.day)) * DAY,
      resetsAt: (day + 1) * DAY,
      capacity: {
        busy: lease !== null,
        ownerRemaining: Math.max(0, limits.owner - counts.owner),
        ownerLimit: limits.owner,
        platformRemaining: Math.max(0, limits.platform - counts.platform),
        platformLimit: limits.platform,
      },
      periods,
      pending: owned
        ? {
            mode: lease.mode,
            startedAt: lease.startedAt,
            deadlineAt: lease.deadlineAt,
            phase: lease.phase,
            milliseconds: Math.max(0, now - lease.startedAt),
          }
        : null,
      instance: {
        provider: "fly",
        region: NODE_LIMITS.region,
        cpuKind: NODE_LIMITS.cpuKind,
        cpus: NODE_LIMITS.cpus,
        memoryMiB: NODE_LIMITS.memoryMiB,
      },
    };
  }
}
