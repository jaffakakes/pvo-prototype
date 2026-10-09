import {
  IDENTITY_PROVIDERS,
  parseIdentityCommand,
  identityEmail,
} from "../../packages/pvo-assistant/identity/index.js";
import { HttpError } from "../http.js";
import { taskId } from "../assistant/tasks/input.js";
import {
  connectionSetupAvailable,
  protectCredential,
  openCredential,
} from "../connections/credentials.js";
import { IdentityStore } from "./store.js";
import { IdentityProviderError } from "./transport.js";

const issue = (code) =>
  ({
    existing_account:
      "The provider reports a signup conflict. Check for an existing account or address, then connect it privately.",
    rejected:
      "The provider rejected this step. Check the details or verification code.",
    uncertain:
      "The provider could not confirm the result. Check its dashboard before creating anything else.",
    connection:
      "The identity is saved but its connection needs attention. Check setup or reconnect privately.",
  })[code] ?? "Setup needs attention. Refresh the saved identity.";

/** Coordinates durable setup intent, human verification, and transfer into the existing account vault. */
export class AgentIdentity {
  constructor(coordinator) {
    this.coordinator = coordinator;
    this.store = new IdentityStore(coordinator.ctx.storage.sql);
  }
  same(provider, revision) {
    const current = this.store.get(provider);
    if ((current?.channel.revision ?? 0) !== revision)
      throw new HttpError(
        409,
        "This identity changed. Refresh its saved status.",
      );
    return current;
  }
  async private(ownerId, current) {
    if (!current?.private) return null;
    return JSON.parse(
      await openCredential(
        this.coordinator.env,
        ownerId,
        `identity-${current.channel.provider}`,
        current.channel.revision,
        current.private,
      ),
    );
  }
  async save(ownerId, provider, revision, changes, privateValue) {
    const prior = this.same(provider, revision);
    const channel = {
      provider,
      status: "starting",
      address: null,
      resourceId: null,
      connectionId: null,
      issue: null,
      approval: null,
      ...prior?.channel,
      ...changes,
      revision: revision + 1,
      updatedAt: this.coordinator.now(),
    };
    const envelope =
      privateValue === null
        ? null
        : await protectCredential(
            this.coordinator.env,
            ownerId,
            `identity-${provider}`,
            channel.revision,
            JSON.stringify(privateValue),
          );
    this.coordinator.ctx.storage.transactionSync(() =>
      this.store.save(channel, envelope, revision),
    );
    return this.store.get(provider);
  }
  list() {
    this.coordinator.accountConnections.expire();
    for (const provider of IDENTITY_PROVIDERS) {
      const saved = this.store.get(provider);
      if (saved?.channel.status !== "ready") continue;
      const connection = this.coordinator.connections.get(
        saved.channel.connectionId,
      );
      if (connection?.status === "connected") continue;
      this.store.save(
        {
          ...saved.channel,
          revision: saved.channel.revision + 1,
          updatedAt: this.coordinator.now(),
          status:
            connection?.status === "revoked"
              ? "disconnected"
              : "needs_attention",
          issue: issue("connection"),
        },
        null,
        saved.channel.revision,
      );
    }
    const channels = IDENTITY_PROVIDERS.map(
      (provider) => this.store.get(provider)?.channel,
    ).filter(Boolean);
    return {
      available: connectionSetupAvailable(this.coordinator.env),
      channels,
    };
  }
  async install(ownerId, current, privateValue) {
    const { provider, revision } = current.channel;
    if (
      !privateValue?.verified ||
      !privateValue.token ||
      !privateValue.resourceId
    )
      throw new HttpError(409, "Finish verification or reconnect privately.");
    const id = `identity-${provider}`;
    const previous = this.coordinator.connections.get(id);
    const result = await this.coordinator.accountConnections.connect(ownerId, {
      id,
      expectedRevision: previous?.revision ?? 0,
      setup: { provider, resourceId: privateValue.resourceId },
      token: privateValue.token,
    });
    this.same(provider, revision);
    return (
      await this.save(
        ownerId,
        provider,
        revision,
        {
          status: "ready",
          address: result.account,
          resourceId: privateValue.resourceId,
          connectionId: id,
          issue: null,
        },
        null,
      )
    ).channel;
  }
  async fail(ownerId, current, privateValue, error, phase) {
    const code =
      error instanceof IdentityProviderError ? error.code : "connection";
    const status =
      phase === "verify" && code === "rejected"
        ? "awaiting_verification"
        : "needs_attention";
    return (
      await this.save(
        ownerId,
        current.channel.provider,
        current.channel.revision,
        { status, issue: issue(code) },
        privateValue,
      )
    ).channel;
  }
  async start(ownerId, input) {
    const prior = this.same(input.provider, input.expectedRevision);
    if (prior)
      throw new HttpError(
        409,
        "This provider already has saved setup. Continue verification or connect its existing identity.",
      );
    let current = await this.save(
      ownerId,
      input.provider,
      input.expectedRevision,
      {
        approval: {
          kind: "create",
          at: this.coordinator.now(),
          monthlyNumberCents: input.monthlyNumberCents,
        },
      },
      {
        humanEmail: identityEmail(input.humanEmail),
        name: input.name,
        token: null,
        resourceId: null,
        verified: false,
      },
    );
    let privateValue = await this.private(ownerId, current);
    try {
      const result = await this.coordinator
        .identityProvider(input.provider)
        .start(privateValue);
      privateValue = { ...privateValue, ...result };
      current = await this.save(
        ownerId,
        input.provider,
        current.channel.revision,
        { status: "awaiting_verification", resourceId: result.resourceId },
        privateValue,
      );
      return current.channel;
    } catch (error) {
      return this.fail(ownerId, current, privateValue, error, "start");
    }
  }
  async verify(ownerId, input, current) {
    if (current.channel.status !== "awaiting_verification")
      throw new HttpError(409, "Refresh the identity before verifying.");
    let privateValue = await this.private(ownerId, current);
    current = await this.save(
      ownerId,
      input.provider,
      current.channel.revision,
      { status: "verifying", issue: null },
      privateValue,
    );
    try {
      privateValue = {
        ...(await this.coordinator
          .identityProvider(input.provider)
          .verify(privateValue, input.code)),
        verified: true,
      };
      // Save the one-time key before making any further network call or reporting completion.
      current = await this.save(
        ownerId,
        input.provider,
        current.channel.revision,
        { resourceId: privateValue.resourceId },
        privateValue,
      );
      return await this.install(ownerId, current, privateValue);
    } catch (error) {
      return this.fail(ownerId, current, privateValue, error, "verify");
    }
  }
  async resend(ownerId, current) {
    let privateValue = await this.private(ownerId, current);
    if (
      ["starting", "verifying", "ready", "disconnected"].includes(
        current.channel.status,
      ) ||
      !privateValue?.humanEmail ||
      privateValue.verified
    )
      throw new HttpError(
        409,
        "Check the saved setup before requesting a verification code.",
      );
    current = await this.save(
      ownerId,
      current.channel.provider,
      current.channel.revision,
      { status: "starting", issue: null },
      privateValue,
    );
    try {
      const result = await this.coordinator
        .identityProvider(current.channel.provider)
        .resend(privateValue);
      privateValue = { ...privateValue, ...result };
      return (
        await this.save(
          ownerId,
          current.channel.provider,
          current.channel.revision,
          {
            status: "awaiting_verification",
            resourceId: privateValue.resourceId,
          },
          privateValue,
        )
      ).channel;
    } catch (error) {
      return this.fail(ownerId, current, privateValue, error, "resend");
    }
  }
  async import(ownerId, input, current) {
    if (current && ["starting", "verifying"].includes(current.channel.status))
      throw new HttpError(
        409,
        "Check the current identity before reconnecting.",
      );
    if (
      current?.channel.resourceId &&
      current.channel.resourceId !== input.resourceId
    )
      throw new HttpError(
        409,
        "Reconnect the same saved inbox or phone number.",
      );
    const privateValue = {
      token: input.token,
      resourceId: input.resourceId,
      verified: true,
    };
    current = await this.save(
      ownerId,
      input.provider,
      input.expectedRevision,
      {
        status: "verifying",
        issue: null,
        approval: current?.channel.approval ?? {
          kind: "existing",
          at: this.coordinator.now(),
          monthlyNumberCents: 0,
        },
      },
      privateValue,
    );
    try {
      return await this.install(ownerId, current, privateValue);
    } catch (error) {
      return this.fail(ownerId, current, privateValue, error, "import");
    }
  }
  async check(ownerId, current) {
    const { provider, revision, status } = current.channel;
    if (
      ["starting", "verifying"].includes(status) &&
      this.coordinator.now() - current.channel.updatedAt < 30000
    )
      return current.channel;
    if (status === "disconnected") return current.channel;
    if (
      !current.private &&
      current.channel.connectionId &&
      ["ready", "needs_attention"].includes(status)
    ) {
      try {
        const saved = this.coordinator.accountConnections.get(
          current.channel.connectionId,
        );
        await this.coordinator.accountConnections.execute(ownerId, "check", {
          id: saved.id,
          expectedRevision: saved.connection.revision,
        });
        this.same(provider, revision);
        if (status !== "ready")
          return (
            await this.save(
              ownerId,
              provider,
              revision,
              { status: "ready", issue: null },
              null,
            )
          ).channel;
        return current.channel;
      } catch {
        return (
          await this.save(
            ownerId,
            provider,
            revision,
            { status: "needs_attention", issue: issue("connection") },
            null,
          )
        ).channel;
      }
    }
    const privateValue = await this.private(ownerId, current);
    if (privateValue?.verified) {
      current = await this.save(
        ownerId,
        provider,
        revision,
        { status: "verifying", issue: null },
        privateValue,
      );
      try {
        return await this.install(ownerId, current, privateValue);
      } catch (error) {
        return this.fail(ownerId, current, privateValue, error, "check");
      }
    }
    if (status === "awaiting_verification") return current.channel;
    return this.fail(
      ownerId,
      current,
      privateValue,
      new IdentityProviderError(503, "uncertain"),
      "check",
    );
  }
  async disconnect(ownerId, current) {
    if (["starting", "verifying"].includes(current.channel.status))
      throw new HttpError(
        409,
        "Wait for setup to finish before disconnecting.",
      );
    if (current.channel.status === "disconnected") return current.channel;
    if (current.channel.connectionId) {
      const connection = this.coordinator.accountConnections.get(
        current.channel.connectionId,
      ).connection;
      await this.coordinator.accountConnections.execute(ownerId, "disconnect", {
        id: connection.id,
        expectedRevision: connection.revision,
      });
    }
    return (
      await this.save(
        ownerId,
        current.channel.provider,
        current.channel.revision,
        {
          status: "disconnected",
          issue:
            "Restyle access is removed. The provider account and any phone billing remain until you manage them there.",
        },
        null,
      )
    ).channel;
  }
  async execute(ownerId, kind, raw) {
    taskId(ownerId);
    this.coordinator.repository.bindOwner(ownerId);
    if (kind === "list") return this.list();
    let input;
    try {
      input = parseIdentityCommand(kind, raw);
    } catch {
      throw new HttpError(
        400,
        "Check the private identity setup fields and consent.",
      );
    }
    if (
      !connectionSetupAvailable(this.coordinator.env) &&
      kind !== "disconnect"
    )
      throw new HttpError(503, "Private identity setup is unavailable.");
    const current = this.same(input.provider, input.expectedRevision);
    if (kind === "discover") {
      const result = await this.coordinator
        .identityProvider(input.provider)
        .discover(input.token);
      this.same(input.provider, input.expectedRevision);
      return {
        ...result,
        resources: result.resources.filter(
          (resource) =>
            !current?.channel.resourceId ||
            current.channel.resourceId === resource.resourceId,
        ),
      };
    }
    if (kind === "start") return this.start(ownerId, input);
    if (kind === "import") return this.import(ownerId, input, current);
    if (!current)
      throw new HttpError(404, "No identity is saved for this provider.");
    if (kind === "verify") return this.verify(ownerId, input, current);
    if (kind === "resend") return this.resend(ownerId, current);
    if (kind === "disconnect") return this.disconnect(ownerId, current);
    return this.check(ownerId, current);
  }
}

export async function manageAgentIdentity(
  coordinator,
  ownerId,
  { kind, input },
) {
  try {
    return {
      ok: true,
      value: await coordinator.agentIdentity.execute(ownerId, kind, input),
    };
  } catch (error) {
    return {
      ok: false,
      status: error instanceof HttpError ? error.status : 503,
      error:
        error instanceof HttpError
          ? error.message
          : "Identity setup could not finish. Refresh its saved status.",
    };
  }
}
