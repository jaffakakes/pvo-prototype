import { parseHostedSummary } from "../../packages/pvo-assistant/hosting/index.js";
import {
  parseOwnedService,
  parseOwnedRelease,
  planOwnedPublication,
  observeOwnedRelease,
  expireOwnedService,
} from "../../packages/pvo-assistant/releases/index.js";
import { HttpError } from "../http.js";

/** Owner-scoped service metadata outlives authoring tasks; immutable source/report bytes live in the release provider. */
export class ServiceCatalog {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS owned_services (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS owned_service_releases (id TEXT PRIMARY KEY, service_id TEXT NOT NULL, body TEXT NOT NULL)`);
  }
  services() {
    return this.sql
      .exec("SELECT body FROM owned_services")
      .toArray()
      .map((row) => parseOwnedService(JSON.parse(row.body)));
  }
  service(id) {
    const row = this.sql
      .exec("SELECT body FROM owned_services WHERE id=?", id)
      .toArray()[0];
    return row ? parseOwnedService(JSON.parse(row.body)) : null;
  }
  releases(serviceId) {
    return this.sql
      .exec(
        "SELECT body FROM owned_service_releases WHERE service_id=?",
        serviceId,
      )
      .toArray()
      .map((row) => parseOwnedRelease(JSON.parse(row.body)));
  }
  release(id) {
    const row = this.sql
      .exec("SELECT body FROM owned_service_releases WHERE id=?", id)
      .toArray()[0];
    return row ? parseOwnedRelease(JSON.parse(row.body)) : null;
  }
  saveService(value) {
    value = parseOwnedService(value);
    this.sql.exec(
      "INSERT INTO owned_services (id,body) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      value.identity.serviceId,
      JSON.stringify(value),
    );
  }
  saveRelease(value) {
    value = parseOwnedRelease(value);
    this.sql.exec(
      "INSERT INTO owned_service_releases (id,service_id,body) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      value.identity.resourceId,
      value.identity.serviceId,
      JSON.stringify(value),
    );
  }
  intent(task, value, now) {
    const identity = value.identity;
    let plan;
    try {
      plan = planOwnedPublication(
        task,
        value,
        {
          service: this.service(identity.serviceId),
          prior: this.release(identity.resourceId),
          services: this.services(),
          releases: this.releases(identity.serviceId),
        },
        now,
      );
    } catch (error) {
      throw Object.assign(
        new HttpError(
          error.code === "budget_exceeded" ? 429 : 409,
          error.message,
        ),
        { code: error.code },
      );
    }
    this.saveService(plan.service);
    const release = plan.release;
    this.saveRelease(release);
    return release;
  }
  observe(identity, state, now) {
    const release = observeOwnedRelease(
      this.release(identity.resourceId),
      identity,
      state,
      now,
    );
    this.saveRelease(release);
    const service = this.service(identity.serviceId);
    this.saveService(
      expireOwnedService(service, this.releases(identity.serviceId), now),
    );
  }
  synchronize(value, now) {
    const summary = parseHostedSummary(value),
      host = summary.service;
    const service = this.service(host.identity.serviceId);
    if (
      !service ||
      ["serviceId", "ownerId", "projectId"].some(
        (key) => service.identity[key] !== host.identity[key],
      )
    )
      throw new Error("Unknown hosted service owner.");
    if (service.hostRevision !== null && service.hostRevision > host.revision)
      return;
    // Validate the complete observation before mutating its catalog projection.
    const releases = summary.releases.map((item) =>
      observeOwnedRelease(
        this.release(item.identity.resourceId),
        item.identity,
        item.state,
        now,
      ),
    );
    for (const release of releases) this.saveRelease(release);
    this.saveService(
      expireOwnedService(
        {
          ...service,
          state: host.state,
          hostRevision: host.revision,
          description:
            host.state === "deleted" ? "Deleted service" : service.description,
          updatedAt: now,
        },
        this.releases(host.identity.serviceId),
        now,
      ),
    );
  }
  maintain(now) {
    for (const service of this.services()) {
      const next = expireOwnedService(
        service,
        this.releases(service.identity.serviceId),
        now,
      );
      if (next !== service) this.saveService(next);
    }
  }
  nextExpiry(now) {
    const times = this.services()
      .filter((item) => item.state === "inactive")
      .flatMap((service) => {
        const releases = this.releases(service.identity.serviceId);
        return releases.length &&
          releases.every((item) => item.state === "deleted")
          ? [Math.max(now, ...releases.map((item) => item.identity.expiresAt))]
          : [];
      });
    return times.length ? Math.min(...times) : null;
  }
}
