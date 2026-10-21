import { randomId } from "../identity.js";

async function linkedUser(identity, db) {
  return db
    .prepare(
      `SELECT users.id, users.display_name AS name FROM supabase_identities
    JOIN users ON users.id = supabase_identities.user_id
    WHERE issuer = ? AND subject = ?`,
    )
    .bind(identity.issuer, identity.sub)
    .first();
}

export async function accountForSupabase(identity, db) {
  const existing = await linkedUser(identity, db);
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
          `INSERT INTO supabase_identities (issuer, subject, user_id)
        VALUES (?, ?, ?)`,
        )
        .bind(identity.issuer, identity.sub, id),
    ]);
    return { id, name: identity.name };
  } catch (error) {
    // A concurrent exchange may have created this identity first.
    const winner = await linkedUser(identity, db);
    if (!winner) throw error;
    return winner;
  }
}
