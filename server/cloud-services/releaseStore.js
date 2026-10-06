import {
  newHostedService,
  parseHostedService,
  selectTestRelease,
} from "../../packages/pvo-assistant/hosting/index.js";
import { TASK_LIMITS } from "../../packages/pvo-assistant/tasks/index.js";
import {
  INACTIVE_SERVICE_LIMITS,
  SERVICE_CATALOG_LIMITS,
  sameServiceIdentity,
  parseServicePublication,
} from "../../packages/pvo-assistant/releases/index.js";
import { HttpError } from "../http.js";

/** One stable service owns bounded immutable releases. The caller owns transactions and alarms. */
export class ServiceReleaseStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS service (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS service_releases (id TEXT PRIMARY KEY, identity TEXT NOT NULL, body TEXT, probes INTEGER NOT NULL DEFAULT 0, retained INTEGER NOT NULL DEFAULT 0)`);
  }
  service() {
    const row = this.sql
      .exec("SELECT body FROM service WHERE id=1")
      .toArray()[0];
    return row ? parseHostedService(JSON.parse(row.body)) : null;
  }
  saveService(value) {
    value = parseHostedService(value);
    this.sql.exec(
      "INSERT INTO service(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      JSON.stringify(value),
    );
  }
  assertOwner(identity) {
    const service = this.service();
    if (
      service &&
      ["serviceId", "ownerId", "projectId"].some(
        (key) => service.identity[key] !== identity[key],
      )
    )
      throw new HttpError(409, "Service ownership conflicts.");
    return service;
  }
  bind(identity, now) {
    let service = this.assertOwner(identity);
    if (!service) {
      service = newHostedService(identity, now);
      this.saveService(service);
    }
    return service;
  }
  deletedIds() {
    return this.sql
      .exec("SELECT id FROM service_releases WHERE body IS NULL")
      .toArray()
      .map((row) => row.id);
  }
  rows() {
    return this.sql
      .exec("SELECT id,identity,body,probes,retained FROM service_releases")
      .toArray();
  }
  row(id) {
    return this.sql
      .exec(
        "SELECT id,identity,body,probes,retained FROM service_releases WHERE id=?",
        id,
      )
      .toArray()[0];
  }
  current(identity, now) {
    this.assertOwner(identity);
    const stored = this.row(identity.resourceId);
    if (!stored) return null;
    if (!sameServiceIdentity(JSON.parse(stored.identity), identity))
      throw new HttpError(
        409,
        "Service ownership or immutable contents conflict.",
      );
    if (now >= identity.expiresAt && stored.body !== null && !stored.retained) {
      this.cancel(identity, now);
      stored.body = null;
    }
    return stored;
  }
  observation(identity, row) {
    return {
      identity,
      state: !row
        ? "missing"
        : row.body === null
          ? "deleted"
          : row.retained
            ? "retained"
            : "available",
    };
  }
  requireCapacity() {
    if (this.rows().length >= SERVICE_CATALOG_LIMITS.releases)
      throw new HttpError(429, "This service has reached its release limit.");
  }
  publish(identity, body, now) {
    if (this.assertOwner(identity)?.state === "deleted")
      throw new HttpError(410, "This service has been deleted.");
    let current = this.current(identity, now);
    if (!current) {
      if (identity.expiresAt > now + TASK_LIMITS.lifetimeMs)
        throw new HttpError(400, "Inactive service lifetime exceeded.");
      this.requireCapacity();
      const service = this.bind(identity, now);
      this.sql.exec(
        "INSERT INTO service_releases(id,identity,body) VALUES(?,?,?)",
        identity.resourceId,
        JSON.stringify(identity),
        now < identity.expiresAt ? body : null,
      );
      current = this.row(identity.resourceId);
      if (current.body !== null)
        this.saveService(selectTestRelease(service, identity.resourceId, now));
    } else if (current.body !== null && current.body !== body)
      throw new HttpError(409, "Published source cannot be replaced.");
    return current;
  }
  cancel(identity, now) {
    const service = this.bind(identity, now),
      row = this.row(identity.resourceId);
    if (row && !sameServiceIdentity(JSON.parse(row.identity), identity))
      throw new HttpError(
        409,
        "Service ownership or immutable contents conflict.",
      );
    if (row?.retained) return;
    if (!row) this.requireCapacity();
    this.sql.exec(
      "INSERT INTO service_releases(id,identity,body) VALUES(?,?,NULL) ON CONFLICT(id) DO UPDATE SET body=NULL",
      identity.resourceId,
      JSON.stringify(identity),
    );
    if (service.testReleaseId === identity.resourceId)
      this.saveService(selectTestRelease(service, null, now));
  }
  retain(id) {
    this.sql.exec(
      "UPDATE service_releases SET retained=1 WHERE id=? AND body IS NOT NULL",
      id,
    );
  }
  deleteReleases() {
    this.sql.exec("UPDATE service_releases SET body=NULL,retained=0");
  }
  consumeProbe(identity, now) {
    const row = this.current(identity, now);
    if (!row || row.body === null)
      throw new HttpError(404, "Inactive service is unavailable.");
    if (row.probes >= INACTIVE_SERVICE_LIMITS.probes)
      throw new HttpError(429, "Inactive service probe limit reached.");
    this.sql.exec(
      "UPDATE service_releases SET probes=probes+1 WHERE id=?",
      identity.resourceId,
    );
    return parseServicePublication(JSON.parse(row.body));
  }
  expire(now) {
    for (const row of this.rows()) this.current(JSON.parse(row.identity), now);
  }
  nextExpiry() {
    const times = this.rows()
      .filter((row) => row.body !== null && !row.retained)
      .map((row) => JSON.parse(row.identity).expiresAt);
    return times.length ? Math.min(...times) : null;
  }
}
