import { randomId } from "../identity.js";
import { HttpError } from "../http.js";

const ACCOUNT_CONFLICT =
  "This email sign-in is already connected to another Restyle account.";

export async function accountIdentityStatus(userId, issuer, db) {
  if (!userId) return { hasGoogle: false, emailLinked: false };
  const identities = await db
    .prepare(
      `SELECT
    EXISTS(SELECT 1 FROM provider_identities WHERE provider = 'google' AND user_id = ?) AS google_identity,
    EXISTS(SELECT 1 FROM managed_identities WHERE provider = 'clerk' AND issuer = ? AND user_id = ?) AS email_identity`,
    )
    .bind(userId, issuer, userId)
    .first();
  return {
    hasGoogle: Boolean(identities.google_identity),
    emailLinked: Boolean(identities.email_identity),
  };
}

export async function userForClerk(identity, db) {
  return db
    .prepare(
      `SELECT users.id, users.display_name AS name FROM managed_identities
    JOIN users ON users.id = managed_identities.user_id
    WHERE provider = 'clerk' AND issuer = ? AND subject = ?`,
    )
    .bind(identity.issuer, identity.sub)
    .first();
}

export async function accountForClerk(identity, db) {
  const existing = await userForClerk(identity, db);
  if (existing) return existing;
  const id = randomId();
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)",
        )
        .bind(id, identity.name, Date.now()),
      db
        .prepare(
          `INSERT INTO managed_identities (provider, issuer, subject, user_id)
        VALUES ('clerk', ?, ?, ?)`,
        )
        .bind(identity.issuer, identity.sub, id),
    ]);
    return { id, name: identity.name };
  } catch (error) {
    // A concurrent exchange may have created this identity first.
    const winner = await userForClerk(identity, db);
    if (!winner) throw error;
    return winner;
  }
}

export async function linkClerkAccount(identity, user, db) {
  const existing = await userForClerk(identity, db);
  if (existing) {
    if (existing.id !== user.id) throw new HttpError(409, ACCOUNT_CONFLICT);
    return user;
  }
  try {
    await db
      .prepare(
        `INSERT INTO managed_identities (provider, issuer, subject, user_id)
      VALUES ('clerk', ?, ?, ?)`,
      )
      .bind(identity.issuer, identity.sub, user.id)
      .run();
  } catch (error) {
    // Both the identity and the owning user are unique within one Clerk instance.
    const winner = await userForClerk(identity, db);
    if (winner?.id !== user.id) throw new HttpError(409, ACCOUNT_CONFLICT);
  }
  return user;
}
