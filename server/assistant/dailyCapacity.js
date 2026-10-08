const defaults = Object.freeze({ global: 60, client: 20 });

/** A short-lived operator policy changes daily admission, never per-minute or execution limits. */
export function assistantDailyCapacity(encoded, now) {
  if (
    !Number.isSafeInteger(now) ||
    typeof encoded !== "string" ||
    encoded.length > 256
  )
    return defaults;
  try {
    const policy = JSON.parse(encoded);
    if (
      !policy ||
      typeof policy !== "object" ||
      Array.isArray(policy) ||
      Object.keys(policy).length !== 3 ||
      !Number.isSafeInteger(policy.expiresAt) ||
      now >= policy.expiresAt ||
      !Number.isSafeInteger(policy.global) ||
      policy.global < 1 ||
      policy.global > 4096 ||
      !Number.isSafeInteger(policy.client) ||
      policy.client < 1 ||
      policy.client > policy.global
    )
      return defaults;
    return { global: policy.global, client: policy.client };
  } catch {
    return defaults;
  }
}
