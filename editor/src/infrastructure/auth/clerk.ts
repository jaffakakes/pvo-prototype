import type { Clerk } from "@clerk/clerk-js";

type ClerkUiConstructor = NonNullable<NonNullable<Parameters<Clerk["load"]>[0]>["ui"]>["ClerkUI"];
let loaded: { key: string; promise: Promise<Clerk> } | null = null;
let uiBundle: Promise<ClerkUiConstructor> | null = null;

function frontendApiHost(publishableKey: string): string {
  const encoded = publishableKey.split("_").slice(2).join("_");
  let host: string;
  try { host = atob(encoded.replace(/-/g, "+").replace(/_/g, "/")).replace(/\$$/, ""); }
  catch { throw new Error("The email sign-in configuration is invalid."); }
  if (!/^[a-z0-9.-]+$/.test(host)
    || !(host.endsWith(".clerk.accounts.dev") || host.endsWith(".getrestyle.app"))) {
    throw new Error("The email sign-in domain is invalid.");
  }
  return host;
}

function loadClerkUi(publishableKey: string): Promise<ClerkUiConstructor> {
  const existing = (window as Window & { __internal_ClerkUICtor?: ClerkUiConstructor }).__internal_ClerkUICtor;
  if (existing) return Promise.resolve(existing);
  if (uiBundle) return uiBundle;
  const host = frontendApiHost(publishableKey);
  const promise = new Promise<ClerkUiConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://${host}/npm/@clerk/ui@1/dist/ui.browser.js`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      const ctor = (window as Window & { __internal_ClerkUICtor?: ClerkUiConstructor }).__internal_ClerkUICtor;
      if (ctor) resolve(ctor);
      else reject(new Error("The email sign-in form did not initialize."));
    };
    script.onerror = () => reject(new Error("The email sign-in form could not be loaded."));
    document.head.appendChild(script);
  }).catch(error => { uiBundle = null; throw error; });
  uiBundle = promise;
  return promise;
}

function navigateWithinEditor(to: string, replace: boolean, windowNavigate?: (to: string) => void) {
  if (windowNavigate) { windowNavigate(to); return; }
  const target = new URL(to, location.href);
  if (target.origin !== location.origin || target.pathname !== location.pathname) {
    location.assign(target.href);
    return;
  }
  if (replace) history.replaceState(history.state, "", target);
  else history.pushState(history.state, "", target);
}

/** Clerk owns password entry, verification, recovery and its browser session. */
export function getClerk(publishableKey: string): Promise<Clerk> {
  if (loaded?.key === publishableKey) return loaded.promise;
  const promise = import("@clerk/clerk-js").then(async ({ Clerk }) => {
    const ClerkUI = await loadClerkUi(publishableKey);
    const clerk = new Clerk(publishableKey);
    await clerk.load({
      ui: { ClerkUI },
      afterSignOutUrl: location.href,
      routerPush: (to, metadata) => navigateWithinEditor(to, false, metadata?.windowNavigate),
      routerReplace: (to, metadata) => navigateWithinEditor(to, true, metadata?.windowNavigate),
    });
    return clerk;
  }).catch(error => {
    if (loaded?.promise === promise) loaded = null;
    throw error;
  });
  loaded = { key: publishableKey, promise };
  return promise;
}

export async function signOutClerk(publishableKey: string): Promise<void> {
  const clerk = await getClerk(publishableKey);
  if (clerk.session) await clerk.signOut(() => {});
}
