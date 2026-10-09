import {
  JOB_LIMITS,
  claimJob,
  settleJob,
} from "../../../packages/pvo-assistant/jobs/index.js";
import { serviceCallError } from "../../../packages/pvo-assistant/hosting/index.js";

/** Per-service durable viewer work; all mutations run inside the host's storage transaction. */
export class ServiceJobStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS service_jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL, bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS service_job_events (id TEXT PRIMARY KEY, jobId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS service_job_usage (day INTEGER PRIMARY KEY, count INTEGER NOT NULL)`);
  }
  eventSeen(id) {
    return (
      this.sql
        .exec("SELECT id FROM service_job_events WHERE id=?", id)
        .toArray().length > 0
    );
  }
  saveEvent(id, jobId) {
    const count = this.sql
      .exec("SELECT COUNT(*) AS count FROM service_job_events")
      .one().count;
    if (count >= 8192)
      throw serviceCallError(
        "budget_exceeded",
        "Provider event records are full.",
      );
    this.sql.exec(
      "INSERT INTO service_job_events(id,jobId) VALUES(?,?)",
      id,
      jobId,
    );
  }
  get(id) {
    const row = this.sql
      .exec("SELECT body FROM service_jobs WHERE id=?", id)
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  all() {
    return this.sql
      .exec("SELECT body FROM service_jobs ORDER BY rowid")
      .toArray()
      .map((row) => JSON.parse(row.body));
  }
  save(job) {
    const body = JSON.stringify(job),
      bytes = new TextEncoder().encode(body).length;
    const used = this.sql
      .exec(
        "SELECT COALESCE(SUM(bytes),0) AS bytes FROM service_jobs WHERE id<>?",
        job.id,
      )
      .one().bytes;
    if (used + bytes > JOB_LIMITS.bytes)
      throw serviceCallError(
        "budget_exceeded",
        "Background records are full. Inspect or remove completed work.",
      );
    this.sql.exec(
      "INSERT INTO service_jobs(id,body,bytes) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,bytes=excluded.bytes",
      job.id,
      body,
      bytes,
    );
    return job;
  }
  insert(job, now) {
    const day = Math.floor(now / 86400000);
    if (
      this.all().length >= JOB_LIMITS.records ||
      (this.sql
        .exec("SELECT count FROM service_job_usage WHERE day=?", day)
        .toArray()[0]?.count ?? 0) >= JOB_LIMITS.daily
    )
      throw serviceCallError(
        "budget_exceeded",
        "This Container has reached its background request limit.",
      );
    this.save(job);
    this.sql.exec(
      "INSERT INTO service_job_usage(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1",
      day,
    );
    return job;
  }
  claim(now, claimId) {
    // Preserve action/data ordering across restarts, including a previous uncertain external write.
    const work = this.all().filter((item) =>
      ["received", "pending", "needs_checking"].includes(item.status),
    );
    if (
      work.some(
        (item) => item.status === "needs_checking" || item.claim?.until > now,
      )
    )
      return null;
    const job = work.find((item) => item.nextAt <= now);
    if (!job) return null;
    const next = claimJob(job, now, claimId);
    if (next) this.save(next);
    return next?.claim ? next : null;
  }
  nextAt(now, active) {
    const values = this.all();
    const work = values.filter((item) =>
      ["received", "pending", "needs_checking"].includes(item.status),
    );
    const times = values
      .filter((item) => item.purgeAt !== null)
      .map((item) => item.purgeAt);
    for (const job of work) {
      if (["received", "pending"].includes(job.status))
        times.push(Math.max(now + 1, job.expiresAt));
    }
    if (active && !work.some((item) => item.status === "needs_checking")) {
      const claimed = work.find((item) => item.claim);
      if (claimed) times.push(Math.max(now + 1, claimed.claim.until));
      else for (const job of work) times.push(Math.max(now + 1, job.nextAt));
    }
    return times.length ? Math.min(...times) : null;
  }
  expire(now) {
    for (const job of this.all()) {
      if (
        ["received", "pending"].includes(job.status) &&
        job.expiresAt <= now &&
        (!job.claim || job.claim.until <= now)
      )
        this.save(
          settleJob(job, "needs_checking", "lifetime_expired", now, job.result),
        );
      if (job.purgeAt !== null && job.purgeAt <= now) {
        this.sql.exec("DELETE FROM service_job_events WHERE jobId=?", job.id);
        this.sql.exec("DELETE FROM service_jobs WHERE id=?", job.id);
      }
    }
    this.sql.exec(
      "DELETE FROM service_job_usage WHERE day<?",
      Math.floor(now / 86400000) - 1,
    );
  }
}
