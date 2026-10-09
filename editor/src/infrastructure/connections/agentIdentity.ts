import {
  parseIdentityChannel,
  type IdentityChannel,
  type IdentityProvider,
} from "../../../../packages/pvo-assistant/identity/index.js";
import { readAssistantJson } from "../assistant/serviceResponse";
import { accountSessionToken } from "../auth/accountSessionToken";

export type IdentityList = { available: boolean; channels: IdentityChannel[] };
export type IdentityResource = { resourceId: string; address: string };
export type IdentityAction =
  "start" | "verify" | "resend" | "import" | "check" | "disconnect";

async function request(
  ownerId: string,
  action: string,
  body: unknown,
  signal: AbortSignal,
) {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(35000)]);
  const token =
    action === "/start" ? await accountSessionToken(ownerId, combined) : null;
  combined.throwIfAborted();
  const response = await fetch(`/api/agent-identity${action}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal: combined,
    headers: {
      Accept: "application/json",
      "X-Restyle-Owner": ownerId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 401
        ? "Sign in again to manage your agent identity."
        : response.status === 403
          ? "Your account changed. Reopen private setup."
          : response.status === 409
            ? "Setup changed. Refresh its saved status before continuing."
            : response.status === 412
              ? "Your sign-in email could not be confirmed. Sign in again before setup."
              : response.status === 400
                ? "Check the setup fields, code and permission."
                : response.status === 429
                  ? "The provider is busy. Wait, then check the saved setup."
                  : "Setup could not respond. Refresh its saved status before creating another account.",
    );
  }
  const value = await readAssistantJson(response, combined, 32768);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "Agent identity status could not be read. Refresh and retry.",
    );
  return value as Record<string, unknown>;
}

export async function listAgentIdentity(
  ownerId: string,
  signal: AbortSignal,
): Promise<IdentityList> {
  const value = await request(ownerId, "", undefined, signal);
  if (
    typeof value.available !== "boolean" ||
    !Array.isArray(value.channels) ||
    value.channels.length > 2
  )
    throw new Error(
      "Agent identity status could not be read. Refresh and retry.",
    );
  const channels = value.channels.map(parseIdentityChannel);
  if (new Set(channels.map((item) => item.provider)).size !== channels.length)
    throw new Error(
      "Agent identity status could not be read. Refresh and retry.",
    );
  return { available: value.available, channels };
}

export async function changeAgentIdentity(
  ownerId: string,
  action: IdentityAction,
  provider: IdentityProvider,
  expectedRevision: number,
  fields: Record<string, unknown>,
  signal: AbortSignal,
) {
  const channel = parseIdentityChannel(
    await request(
      ownerId,
      `/${action}`,
      { provider, expectedRevision, ...fields },
      signal,
    ),
  );
  if (channel.provider !== provider)
    throw new Error(
      "The saved identity belongs to different setup. Refresh and retry.",
    );
  return channel;
}

export async function discoverAgentIdentity(
  ownerId: string,
  provider: IdentityProvider,
  expectedRevision: number,
  token: string,
  signal: AbortSignal,
) {
  const value = await request(
    ownerId,
    "/discover",
    { provider, expectedRevision, token, consent: true },
    signal,
  );
  if (
    !Array.isArray(value.resources) ||
    value.resources.length > 50 ||
    typeof value.more !== "boolean"
  )
    throw new Error("The provider's inboxes or numbers could not be read.");
  const resources: IdentityResource[] = value.resources.map((item: unknown) => {
    if (!item || typeof item !== "object")
      throw new Error("The provider's inboxes or numbers could not be read.");
    const data = item as Record<string, unknown>;
    if (
      typeof data.resourceId !== "string" ||
      data.resourceId.length > 254 ||
      typeof data.address !== "string" ||
      data.address.length > 254
    )
      throw new Error("The provider's inboxes or numbers could not be read.");
    return { resourceId: data.resourceId, address: data.address };
  });
  return { resources, more: value.more };
}
