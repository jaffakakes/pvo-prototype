const STORAGE_KEY = "restyle-account-session";

function identity(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const { iss, sub, session_id } = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (
      typeof iss !== "string" ||
      !/^https:\/\/[a-z0-9-]+\.supabase\.co\/auth\/v1$/.test(iss) ||
      typeof sub !== "string" ||
      typeof session_id !== "string"
    )
      return null;
    return JSON.stringify([iss, sub, session_id]);
  } catch {
    return null;
  }
}

// This records sign-in intent, never credentials. The server verifies every renewal.
export function rememberAccountSession(token: string): void {
  const value = identity(token);
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* Sign-in can still complete when browser storage is unavailable. */
  }
}

export function forgetAccountSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Storage is unavailable. */
  }
}

export function rememberedAccountSession(projectUrl: string): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value && JSON.parse(value)[0] === `${projectUrl}/auth/v1`) return value;
  } catch {
    /* Missing or inaccessible storage requires explicit sign-in. */
  }
  return null;
}

export function matchesRememberedSession(
  token: string,
  remembered: string,
): boolean {
  return identity(token) === remembered;
}
