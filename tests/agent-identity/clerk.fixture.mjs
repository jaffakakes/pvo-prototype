let current;
export function setClerkFixture(value) {
  current = value;
}
export async function getClerk() {
  if (!current) throw new Error("Clerk should not load for this action");
  return current();
}
