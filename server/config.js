const MIB = 1024 * 1024;

function positive(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function configuration(env, requestOrigin) {
  let origin = null;
  try {
    const configured = new URL(env.PUBLIC_ORIGIN);
    if (configured.protocol === "https:" && configured.pathname === "/" && !configured.search && !configured.hash)
      origin = configured.origin;
  } catch { /* Missing configuration leaves publishing disabled. */ }
  return {
    origin,
    available: env.PUBLISHING_ENABLED === "true" && Boolean(env.DB && env.MEDIA && origin === requestOrigin
      && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET?.length >= 32),
    maxBytes: positive(env.MAX_UPLOAD_BYTES, 50 * MIB, 50 * MIB),
    ownerQuota: positive(env.OWNER_STORAGE_BYTES, 500 * MIB),
    totalQuota: positive(env.TOTAL_STORAGE_BYTES, 5 * 1024 * MIB),
    dailyPublications: positive(env.DAILY_PUBLICATIONS, 20, 100),
    pendingMs: 24 * 60 * 60 * 1000,
    uploadMs: 15 * 60 * 1000,
  };
}
