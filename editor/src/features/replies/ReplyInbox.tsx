import { useEffect, useState } from "react";
import { useAuthGate } from "../../state/auth/authGateStore";
import { useReplyInbox } from "./useReplyInbox";
import styles from "./ReplyInbox.module.css";

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString();
}

function answerLabel(value: string | number | boolean): string {
  return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
}

/** The owner inbox is independent of any retained export or open Share dialog. */
export function ReplyInbox() {
  const accountAvailable = useAuthGate(
    (state) => state.available || state.clerkAvailable,
  );
  const {
    boxes,
    selectedId,
    replies,
    message,
    emptySession,
    requiresSignIn,
    busy,
    deleting,
    loadBoxes,
    openBox,
    removeBox,
    back,
  } = useReplyInbox();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    setConfirmDelete(null);
  }, [selectedId]);

  const selected = boxes.find((box) => box.id === selectedId);
  return (
    <div className={styles.inbox}>
      <p className={styles.note}>
        {accountAvailable
          ? "Replies belong to your account. Sign in on your devices to read them. Boxes and replies are deleted after 180 days."
          : "This beta keeps inbox access in this browser. Clearing site data loses access. Boxes and replies are deleted after 180 days."}
      </p>
      <div className={styles.toolbar}>
        <strong>{selected ? selected.title : "Reply boxes"}</strong>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (selected) void openBox(selected);
            else void loadBoxes();
          }}
        >
          Refresh
        </button>
      </div>
      {busy && (
        <p role="status" className={styles.note}>
          {deleting ? "Deleting…" : "Loading…"}
        </p>
      )}
      {message && (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      )}
      {requiresSignIn && !busy && (
        <p className={styles.note}>Sign in to read your replies.</p>
      )}
      {emptySession && !busy && (
        <p className={styles.note}>
          No replies session in this browser. Set up Collect replies on a Form
          to start one.
        </p>
      )}
      {!selected &&
        !emptySession &&
        !requiresSignIn &&
        !busy &&
        !boxes.length &&
        !message && (
          <p className={styles.note}>
            No reply boxes yet. Add a Form and choose Collect replies in its
            Action tab.
          </p>
        )}
      {selected ? (
        <>
          <button
            type="button"
            className={styles.back}
            onClick={back}
            disabled={deleting}
          >
            ← All reply boxes
          </button>
          {replies && !replies.length && (
            <p className={styles.note}>No replies yet.</p>
          )}
          {replies && (
            <ol className={styles.replies}>
              {replies.map((reply) => (
                <li key={reply.id}>
                  <time dateTime={reply.createdAt}>
                    {dateLabel(reply.createdAt)}
                  </time>
                  <dl>
                    {reply.answers.map((answer, index) => (
                      <div key={`${reply.id}-${index}`}>
                        <dt>{answer.name}</dt>
                        <dd>{answerLabel(answer.value)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ol>
          )}
          {confirmDelete === selected.id ? (
            <div
              className={styles.deleteConfirm}
              role="group"
              aria-label="Delete reply box"
            >
              <p>
                Delete this box and permanently remove its saved replies? New
                submissions to any video using it will stop.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmDelete(null)}
              >
                Keep box
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void removeBox(selected);
                }}
              >
                Delete box and replies
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.delete}
              disabled={busy}
              onClick={() => setConfirmDelete(selected.id)}
            >
              Delete this box…
            </button>
          )}
        </>
      ) : (
        <ul className={styles.boxes}>
          {boxes.map((box) => (
            <li key={box.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void openBox(box);
                }}
              >
                <span>
                  <strong>{box.title}</strong>
                  <small>{dateLabel(box.createdAt)}</small>
                </span>
                <b>
                  {box.count} {box.count === 1 ? "reply" : "replies"}
                </b>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
