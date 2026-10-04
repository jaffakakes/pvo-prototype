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
  const managedAuthReady = Boolean(env.DB && origin === requestOrigin && env.SESSION_SECRET?.length >= 32
    && env.CLERK_PUBLISHABLE_KEY && clerkIssuer(env.CLERK_ISSUER));
  return {
    origin,
    available: env.PUBLISHING_ENABLED === "true" && Boolean(env.DB && env.MEDIA && origin === requestOrigin
      && env.SESSION_SECRET?.length >= 32),
    authAvailable: Boolean(env.DB && origin === requestOrigin && env.SESSION_SECRET?.length >= 32
      && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    clerkAvailable: managedAuthReady,
    clerkIssuer: managedAuthReady ? clerkIssuer(env.CLERK_ISSUER) : null,
    maxBytes: positive(env.MAX_UPLOAD_BYTES, 50 * MIB, 50 * MIB),
    ownerQuota: positive(env.OWNER_STORAGE_BYTES, 500 * MIB),
    totalQuota: positive(env.TOTAL_STORAGE_BYTES, 5 * 1024 * MIB),
    dailyPublications: positive(env.DAILY_PUBLICATIONS, 20, 100),
    pendingMs: 24 * 60 * 60 * 1000,
    uploadMs: 15 * 60 * 1000,
  };
}
