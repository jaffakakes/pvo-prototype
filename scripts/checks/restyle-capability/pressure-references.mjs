/** Independent, synthetic specifications. Never included in model messages. */
export function quiz({ input, state }) {
  const counts = { red: 0, blue: 0 };
  for (const answer of input.answers) if (answer !== "skip") counts[answer]++;
  const winner =
    counts.red === counts.blue
      ? "tie"
      : counts.red > counts.blue
        ? "red"
        : "blue";
  return { state, result: { winner, answered: counts.red + counts.blue } };
}

export function chooser({ input, state }) {
  const products = [
    { id: "A", price: 10, tags: ["light"] },
    { id: "B", price: 15, tags: ["light", "quiet"] },
    { id: "C", price: 15, tags: ["quiet"] },
  ];
  const candidates = products.filter((p) => p.price <= input.budget);
  candidates.sort((a, b) => {
    const score = (p) =>
      new Set(input.preferences.filter((tag) => p.tags.includes(tag))).size;
    return score(b) - score(a) || a.price - b.price || a.id.localeCompare(b.id);
  });
  return { state, result: candidates[0]?.id ?? "none" };
}

export function waitlist({ operation, input, state }) {
  const next = structuredClone(state);
  if (operation === "status") return { state: next, result: next };
  const name = input.name.trim();
  if (!name) return { state: next, result: "invalid" };
  const active = next.active.indexOf(name),
    waiting = next.waiting.indexOf(name);
  let result;
  if (operation === "join") {
    if (active >= 0 || waiting >= 0) result = "duplicate";
    else if (next.active.length < next.capacity) {
      next.active.push(name);
      result = "accepted";
    } else if (next.waiting.length === 8) result = "full";
    else {
      next.waiting.push(name);
      result = "waiting";
    }
  } else if (active >= 0) {
    next.active.splice(active, 1);
    if (next.waiting.length) next.active.push(next.waiting.shift());
    result = "cancelled";
  } else if (waiting >= 0) {
    next.waiting.splice(waiting, 1);
    result = "cancelled";
  } else result = "absent";
  return { state: next, result };
}

export function quote({ input, state }) {
  const prices = { pen: 125, book: 999 };
  let subtotal = 0;
  for (const line of input.items) {
    if (
      !Object.hasOwn(prices, line.id) ||
      line.quantity < 0 ||
      line.quantity > 100
    )
      return { state, result: { status: "invalid", cents: 0 } };
    subtotal += prices[line.id] * line.quantity;
  }
  return {
    state,
    result: {
      status: "quoted",
      cents: Math.floor((subtotal * (input.discount ? 90 : 100) + 50) / 100),
    },
  };
}

export const references = { B1: quiz, B2: chooser, B3: waitlist, B4: quote };
