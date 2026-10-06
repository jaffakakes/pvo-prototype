const MIB = 1024 * 1024;

function positive(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function clerkIssuer(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.pathname === "/" && !url.search && !url.hash
      && !url.username && !url.password) return url.origin;
  } catch { /* A missing or invalid issuer disables Clerk sign-in. */ }
  return null;
}

export function configuration(env, requestOrigin) {
  let origin = null;
  try {
    const configured = new URL(env.PUBLIC_ORIGIN);
    if (configured.protocol === "https:" && configured.pathname === "/" && !configured.search && !configured.hash)
      origin = configured.origin;
  } catch { /* Missing configuration leaves publishing disabled. */ }
  const available = env.PUBLISHING_ENABLED === "true" && Boolean(env.DB && env.MEDIA && origin === requestOrigin
    && env.SESSION_SECRET?.length >= 32);
  const managedAuthReady = Boolean(env.DB && origin === requestOrigin && env.SESSION_SECRET?.length >= 32
    && env.CLERK_PUBLISHABLE_KEY && clerkIssuer(env.CLERK_ISSUER));
  return {
    origin,
    available,
    authAvailable: Boolean(env.DB && origin === requestOrigin && env.SESSION_SECRET?.length >= 32
      && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    renderAvailable: available && env.RENDERING_ENABLED === "true"
      && typeof env.RENDER_QUEUE?.send === "function"
      && typeof env.RENDERER?.get === "function"
      && typeof env.RENDERER?.idFromName === "function",
    clerkAvailable: managedAuthReady,
    clerkIssuer: managedAuthReady ? clerkIssuer(env.CLERK_ISSUER) : null,
    // Multipart uploads use at most 10,000 parts. This is a transport limit,
    // not an account or site storage allowance.
    maxBytes: 64 * MIB * 10000,
    dailyPublications: positive(env.DAILY_PUBLICATIONS, 20, 100),
    pendingMs: 24 * 60 * 60 * 1000,
    uploadMs: 15 * 60 * 1000,
    multipartMs: 6 * 60 * 60 * 1000,
  };
}
