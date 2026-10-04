export type AccountUser = { id: string; name: string };
export type AccountSession = {
  available: boolean;
  user: AccountUser | null;
  clerkAvailable: boolean;
  clerkPublishableKey: string | null;
  canLinkEmail: boolean;
  emailLinked: boolean;
};

function accountSession(value: unknown): AccountSession {
  if (!value || typeof value !== "object") throw new Error("The account service returned an invalid response.");
  const response = value as Record<string, unknown>;
  const user = response.user;
  if (typeof response.available !== "boolean"
    || typeof response.clerkAvailable !== "boolean"
    || typeof response.canLinkEmail !== "boolean"
    || typeof response.emailLinked !== "boolean"
    || (response.clerkPublishableKey !== null && typeof response.clerkPublishableKey !== "string")
    || (response.clerkAvailable && !response.clerkPublishableKey)
    || (response.canLinkEmail && (!response.clerkAvailable || response.emailLinked || !user))
    || (response.emailLinked && !user)
    || (user !== null && (
    !user || typeof user !== "object" || typeof (user as Record<string, unknown>).id !== "string"
    || typeof (user as Record<string, unknown>).name !== "string"
  ))) throw new Error("The account service returned an invalid response.");
  return {
    available: response.available,
    user: user as AccountUser | null,
    clerkAvailable: response.clerkAvailable,
    clerkPublishableKey: response.clerkPublishableKey,
    canLinkEmail: response.canLinkEmail,
    emailLinked: response.emailLinked,
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
    if (controller.signal.aborted) throw new Error("Account check timed out. Try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getAccountSession(): Promise<AccountSession> {
  const response = await request("/api/auth/session", { method: "GET" });
  if ([404, 501].includes(response.status)) return {
    available: false, user: null, clerkAvailable: false, clerkPublishableKey: null,
    canLinkEmail: false, emailLinked: false,
  };
  if (!response.ok) throw new Error("Couldn't check your account. Try again.");
  if (!response.headers.get("Content-Type")?.includes("application/json"))
    throw new Error("The account service isn't available here.");
  return accountSession(await response.json());
}

export async function logOutAccount(): Promise<void> {
  const response = await request("/api/auth/logout", { method: "POST" });
  if (!response.ok) throw new Error("Couldn't sign out. Try again.");
}

export function googleSignInUrl(): string {
  return new URL("/api/auth/google/start", location.origin).href;
}

export async function exchangeClerkSession(token: string): Promise<void> {
  const response = await request("/api/auth/clerk/exchange", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Couldn't finish email sign-in. Try again.");
}

export async function linkClerkSession(token: string, expectedUserId: string): Promise<void> {
  const response = await request("/api/auth/clerk/link", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expectedUserId }),
  });
  if (response.status === 409)
    throw new Error("This email account is already connected to another Restyle account.");
  if (response.status === 412)
    throw new Error("Your Restyle account changed. Sign in with the original Google account and try again.");
  if (response.status === 401 || response.status === 403)
    throw new Error("Sign in with Google again before connecting email.");
  if (!response.ok) throw new Error("Couldn't connect email sign-in. Try again.");
}
