/** File owners release their lease only after streams/processes have settled. */
export function createFileOwnership() {
  const owners = new Set();
  return {
    acquire(kind) {
      let release;
      const settled = new Promise((resolve) => {
        release = resolve;
      });
      const owner = { kind, settled };
      owners.add(owner);
      return () => {
        owners.delete(owner);
        release();
      };
    },
    count(kind) {
      return [...owners].filter((owner) => owner.kind === kind).length;
    },
    async settled() {
      await Promise.all([...owners].map((owner) => owner.settled));
    },
  };
}
