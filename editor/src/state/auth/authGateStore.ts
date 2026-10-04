import { create } from "zustand";
import { getAccountSession, logOutAccount, type AccountSession, type AccountUser } from "../../infrastructure/auth/client";
import { clearAccountPublication } from "../export/exportArtifactStore";

export type AuthSource = "signin" | "export" | "download" | "share" | "replies";
type AuthGateState = {
  source: AuthSource | null;
  phase: "idle" | "checking" | "ready" | "error";
  available: boolean;
  clerkAvailable: boolean;
  clerkPublishableKey: string | null;
  canLinkEmail: boolean;
  emailLinked: boolean;
  user: AccountUser | null;
  error: string | null;
  connecting: boolean;
};

export const useAuthGate = create<AuthGateState>(() => ({
  source: null,
  phase: "idle",
  available: false,
  clerkAvailable: false,
  clerkPublishableKey: null,
  canLinkEmail: false,
  emailLinked: false,
  user: null,
  error: null,
  connecting: false,
}));

let sessionRequest: Promise<AccountSession> | null = null;
let sessionEpoch = 0;
let signOutRequest: Promise<void> | null = null;
let pendingAccount: { promise: Promise<boolean>; resolve(value: boolean): void } | null = null;

function currentSession(): AccountSession {
  const { available, user, clerkAvailable, clerkPublishableKey, canLinkEmail, emailLinked } = useAuthGate.getState();
  return { available, user: signOutRequest ? null : user, clerkAvailable, clerkPublishableKey,
    canLinkEmail: signOutRequest ? false : canLinkEmail, emailLinked: signOutRequest ? false : emailLinked };
}

function resolvePendingAccount(signedIn: boolean) {
  pendingAccount?.resolve(signedIn);
  pendingAccount = null;
}

export function openSignIn(source: AuthSource = "signin") {
  useAuthGate.setState({ source, error: null });
}

export function closeAuthGate() {
  useAuthGate.setState({ source: null, error: null, connecting: false });
  resolvePendingAccount(false);
}

export function setAuthError(message: string) {
  useAuthGate.setState({ error: message, connecting: false });
}

export function setAuthConnecting(connecting: boolean) {
  useAuthGate.setState({ connecting, error: null });
}

export function refreshAccountSession(): Promise<AccountSession> {
  if (signOutRequest) return Promise.resolve(currentSession());
  if (sessionRequest) return sessionRequest;
  const requestEpoch = sessionEpoch;
  useAuthGate.setState({ phase: "checking", error: null });
  const request = getAccountSession().then(session => {
    if (requestEpoch !== sessionEpoch) return currentSession();
    const previousUser = useAuthGate.getState().user;
    if (previousUser && previousUser.id !== session.user?.id) clearAccountPublication();
    useAuthGate.setState(state => ({
      phase: "ready",
      available: session.available,
      clerkAvailable: session.clerkAvailable,
      clerkPublishableKey: session.clerkPublishableKey,
      canLinkEmail: session.canLinkEmail,
      emailLinked: session.emailLinked,
      user: session.user,
      error: null,
      connecting: session.user ? false : state.connecting,
    }));
    if (session.user && pendingAccount) {
      useAuthGate.setState({ source: null });
      resolvePendingAccount(true);
    }
    return session;
  }).catch(error => {
    if (requestEpoch !== sessionEpoch) return currentSession();
    if (useAuthGate.getState().user) clearAccountPublication();
    useAuthGate.setState({
      phase: "error",
      user: null,
      canLinkEmail: false,
      emailLinked: false,
      error: error instanceof Error ? error.message : "Couldn't check your account. Try again.",
      connecting: false,
    });
    throw error;
  }).finally(() => { if (sessionRequest === request) sessionRequest = null; });
  sessionRequest = request;
  return sessionRequest;
}

/** A completed provider exchange invalidates checks started before its cookie existed. */
export function refreshAccountSessionAfterSignIn(): Promise<AccountSession> {
  sessionEpoch++;
  sessionRequest = null;
  return refreshAccountSession();
}

/** Check the live session before every protected action; wait without losing the editor when signed out. */
export async function requireAccount(source: Exclude<AuthSource, "signin"> = "export"): Promise<boolean> {
  if (signOutRequest) return false;
  const requestEpoch = sessionEpoch;
  try {
    const session = await refreshAccountSession();
    if (requestEpoch !== sessionEpoch || signOutRequest) return false;
    if (session.user) return true;
  } catch {
    // The dialog retains the check error and offers a retry.
  }
  if (requestEpoch !== sessionEpoch || signOutRequest) return false;
  const checkError = useAuthGate.getState().error;
  openSignIn(source);
  if (checkError) setAuthError(checkError);
  if (!pendingAccount) {
    let resolve!: (value: boolean) => void;
    const promise = new Promise<boolean>(done => { resolve = done; });
    pendingAccount = { promise, resolve };
  }
  return pendingAccount.promise;
}

async function performSignOut(): Promise<void> {
  try {
    await logOutAccount();
  } catch (error) {
    // A failed response cannot tell us whether logout committed; verify the live account.
    signOutRequest = null;
    try {
      if (!(await refreshAccountSession()).user) return;
    } catch { /* The account check retains its error state. */ }
    throw error;
  }
  clearAccountPublication();
  useAuthGate.setState({ user: null, canLinkEmail: false, emailLinked: false,
    error: null, connecting: false, phase: "ready" });
}

export function signOutAccount(): Promise<void> {
  if (signOutRequest) return signOutRequest;
  sessionEpoch++;
  sessionRequest = null;
  resolvePendingAccount(false);
  const request = performSignOut().finally(() => { if (signOutRequest === request) signOutRequest = null; });
  signOutRequest = request;
  return request;
}
