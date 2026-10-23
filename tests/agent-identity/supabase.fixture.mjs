let current;
export function setSupabaseFixture(value) {
  current = value;
}
export async function getSupabase() {
  if (!current) throw new Error("Supabase should not load for this action");
  return current();
}
