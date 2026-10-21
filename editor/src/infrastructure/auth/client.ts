import { getSupabase } from "./supabase";
import {
  rememberAccountSession,
  forgetAccountSession,
  rememberedAccountSession,
  matchesRememberedSession,
} from "./rememberedSession";

export type AccountUser = { id: string; name: string };
export type AccountSession = {
  available: boolean;
  user: AccountUser | null;
  supabaseAvailable: boolean;
  supabasePublishableKey: string | null;
  supabaseUrl: string | null;
};

function accountSession(value: unknown): AccountSession {
  if (!value || typeof value !== "object")
    throw new Error("The account service returned an invalid response.");
  const response = value as Record<string, unknown>;
  const user = response.user;
  if (
    typeof response.available !== "boolean" ||
    typeof response.supabaseAvailable !== "boolean" ||
    (response.supabasePublishableKey !== null &&
      typeof response.supabasePublishableKey !== "string") ||
    (response.supabaseUrl !== null &&
      (typeof response.supabaseUrl !== "string" ||
        !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(response.supabaseUrl))) ||
    (response.supabaseAvailable &&
      (!response.supabasePublishableKey || !response.supabaseUrl)) ||
    (user !== null &&
      (!user ||
        typeof user !== "object" ||
        typeof (user as Record<string, unknown>).id !== "string" ||
        typeof (user as Record<string, unknown>).name !== "string"))
  )
    throw new Error("The account service returned an invalid response.");
  return {
    available: response.available,
    user: user as AccountUser | null,
    supabaseAvailable: response.supabaseAvailable,
    supabasePublishableKey: response.supabasePublishableKey,
    supabaseUrl: response.supabaseUrl,
  } as AccountSession;
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(path, {
      ...init,
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("Account check timed out. Try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getAccountSession(): Promise<AccountSession> {
  const response = await request("/api/auth/session", { method: "GET" });
  if ([404, 501].includes(response.status))
    return {
      available: false,
      user: null,
      supabaseAvailable: false,
      supabasePublishableKey: null,
      supabaseUrl: null,
    };
  if (!response.ok) throw new Error("Couldn't check your account. Try again.");
  if (!response.headers.get("Content-Type")?.includes("application/json"))
    throw new Error("The account service isn't available here.");
  return accountSession(await response.json());
}

let sessionMutation: Promise<void> = Promise.resolve();

// Order cookie writes so an in-flight renewal cannot land after sign-out.
function mutateSession(operation: () => Promise<void>): Promise<void> {
  const request = sessionMutation.then(async () => {
    if (typeof navigator !== "undefined" && navigator.locks)
      await navigator.locks.request("restyle-account-session", operation);
    else await operation();
  });
  sessionMutation = request.catch(() => {});
  return request;
}

export function logOutAccount(): Promise<void> {
  return mutateSession(async () => {
    const response = await request("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("Couldn't sign out. Try again.");
    forgetAccountSession();
  });
}

async function exchangeSession(token: string): Promise<void> {
  const response = await request("/api/auth/supabase/exchange", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Couldn't finish sign-in. Try again.");
}

/** Renew only a provider session the user previously accepted in this browser. */
export async function restoreAccountSession(
  isCurrent: () => boolean,
): Promise<AccountSession> {
  const account = await getAccountSession();
  if (
    account.user ||
    !account.supabaseAvailable ||
    !account.supabaseUrl ||
    !account.supabasePublishableKey
  )
    return account;
  const remembered = rememberedAccountSession(account.supabaseUrl);
  if (!remembered || !isCurrent()) return account;
  const provider = await getSupabase(
    account.supabaseUrl,
    account.supabasePublishableKey,
  );
  const { data, error } = await provider.auth.getSession();
  if (
    !isCurrent() ||
    rememberedAccountSession(account.supabaseUrl) !== remembered
  )
    return account;
  if (error) throw new Error("Couldn't restore your sign-in. Try again.");
  if (
    !data.session ||
    !matchesRememberedSession(data.session.access_token, remembered)
  )
    return account;
  const token = data.session.access_token;
  const projectUrl = account.supabaseUrl;
  await mutateSession(async () => {
    if (isCurrent() && rememberedAccountSession(projectUrl) === remembered)
      await exchangeSession(token);
  });
  return getAccountSession();
}

export function exchangeSupabaseSession(token: string): Promise<void> {
  return mutateSession(async () => {
    await exchangeSession(token);
    rememberAccountSession(token);
  });
}
