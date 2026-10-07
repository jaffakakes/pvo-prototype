import { useContainerCreation } from "./useContainerCreation";
import styles from "./ServicesPanel.module.css";

export function CreateContainer({
  ownerId,
  onCreated,
}: {
  ownerId: string;
  onCreated: (id: string) => void;
}) {
  const { localId, description, setDescription, pending, busy, error, submit } =
    useContainerCreation(ownerId, onCreated);
  return (
    <div className={styles.create}>
      <label>
        New Container name
        <input
          value={description}
          disabled={busy || !!pending}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Dinner bookings"
        />
      </label>
      {!localId && !pending && (
        <p>
          Open or save a project to create its Container. You can add a
          Component later.
        </p>
      )}
      {pending && (
        <p role="status">
          A saved creation request needs its result confirmed.
        </p>
      )}
      <button
        type="button"
        disabled={busy || (!pending && (!localId || !description.trim()))}
        onClick={() => void submit()}
      >
        {busy
          ? "Creating…"
          : pending
            ? "Retry Container creation"
            : "Create Container"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
