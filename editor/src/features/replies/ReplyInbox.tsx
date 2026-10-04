import { useEffect, useRef, useState } from "react";
import { createRepliesClient, RepliesHttpError, type CollectedReply, type ReplyBox } from "../../infrastructure/replies/client";
import { refreshAccountSession, requireAccount, useAuthGate } from "../../state/auth/authGateStore";
import styles from "./ReplyInbox.module.css";

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
}

function answerLabel(value: string | number | boolean): string {
  return typeof value === "boolean" ? value ? "Yes" : "No" : String(value);
}

function operationMessage(error: unknown, fallback: string): string {
  return error instanceof RepliesHttpError ? error.message : fallback;
}

/** The owner inbox is independent of any retained export or open Share dialog. */
export function ReplyInbox() {
  const [client] = useState(() => createRepliesClient());
  const accountAvailable = useAuthGate(state => state.available || state.clerkAvailable);
  const accountUserId = useAuthGate(state => state.user?.id ?? null);
  const [boxes, setBoxes] = useState<ReplyBox[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replies, setReplies] = useState<CollectedReply[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [emptySession, setEmptySession] = useState(false);
  const [requiresSignIn, setRequiresSignIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const previousAccountId = useRef(accountUserId);

  const loadBoxes = async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setMessage(null);
    try {
      const account = await refreshAccountSession();
      if ((account.available || account.clerkAvailable) && !account.user && !await requireAccount("replies")) {
        if (!controller.signal.aborted) setRequiresSignIn(true);
        return;
      }
      controller.signal.throwIfAborted();
      const rows = await client.listBoxes(controller.signal);
      if (controller.signal.aborted) return;
      setBoxes(rows);
      setEmptySession(false);
      setRequiresSignIn(false);
      setSelectedId(previous => previous && rows.some(box => box.id === previous) ? previous : null);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof RepliesHttpError && error.status === 401) {
        const account = useAuthGate.getState();
        const hasAccountService = account.available || account.clerkAvailable;
        setEmptySession(!hasAccountService);
        setRequiresSignIn(hasAccountService);
        setBoxes([]);
        setSelectedId(null);
        setReplies(null);
      } else setMessage(operationMessage(error, "Couldn’t load replies. Try again."));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };

  useEffect(() => {
    void loadBoxes();
    return () => active.current?.abort();
  }, [client]);

  useEffect(() => {
    const before = previousAccountId.current;
    previousAccountId.current = accountUserId;
    if (!before || accountUserId) return;
    active.current?.abort();
    setBoxes([]);
    setSelectedId(null);
    setReplies(null);
    setRequiresSignIn(true);
  }, [accountUserId]);

  const openBox = async (box: ReplyBox) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setSelectedId(box.id);
    setReplies(null);
    setBusy(true);
    setMessage(null);
    try {
      const rows = await client.listReplies(box.id, controller.signal);
      if (!controller.signal.aborted) setReplies(rows);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(operationMessage(error, "Couldn’t load this box. Try again."));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };

  const removeBox = async (box: ReplyBox) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setMessage(null);
    try {
      await client.deleteBox(box.id, controller.signal);
      if (controller.signal.aborted) return;
      setConfirmDelete(null);
      setSelectedId(null);
      setReplies(null);
      setBoxes(previous => previous.filter(item => item.id !== box.id));
    } catch (error) {
      if (!controller.signal.aborted) setMessage(operationMessage(error, "Couldn’t delete this box. Try again."));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };

  const selected = boxes.find(box => box.id === selectedId);
  return <div className={styles.inbox}>
    <p className={styles.note}>{accountAvailable
      ? "Replies belong to your account. Sign in on your devices to read them. Boxes and replies are deleted after 180 days."
      : "This beta keeps inbox access in this browser. Clearing site data loses access. Boxes and replies are deleted after 180 days."}</p>
    <div className={styles.toolbar}>
      <strong>{selected ? selected.title : "Reply boxes"}</strong>
      <button type="button" disabled={busy} onClick={() => { if (selected) void openBox(selected); else void loadBoxes(); }}>Refresh</button>
    </div>
    {busy && <p role="status" className={styles.note}>Loading…</p>}
    {message && <p role="alert" className={styles.error}>{message}</p>}
    {requiresSignIn && !busy && <p className={styles.note}>Sign in to read your replies.</p>}
    {emptySession && !busy && <p className={styles.note}>No replies session in this browser. Set up Collect replies on a Form to start one.</p>}
    {!selected && !emptySession && !requiresSignIn && !busy && !boxes.length && !message && <p className={styles.note}>No reply boxes yet. Add a Form and choose Collect replies in its Action tab.</p>}
    {selected ? <>
      <button type="button" className={styles.back} onClick={() => { setSelectedId(null); setReplies(null); setConfirmDelete(null); }}>← All reply boxes</button>
      {replies && !replies.length && <p className={styles.note}>No replies yet.</p>}
      {replies && <ol className={styles.replies}>{replies.map(reply => <li key={reply.id}>
        <time dateTime={reply.createdAt}>{dateLabel(reply.createdAt)}</time>
        <dl>{reply.answers.map((answer, index) => <div key={`${reply.id}-${index}`}>
          <dt>{answer.name}</dt><dd>{answerLabel(answer.value)}</dd>
        </div>)}</dl>
      </li>)}</ol>}
      {confirmDelete === selected.id ? <div className={styles.deleteConfirm} role="group" aria-label="Delete reply box">
        <p>Delete this box and permanently remove its saved replies? New submissions to any video using it will stop.</p>
        <button type="button" disabled={busy} onClick={() => setConfirmDelete(null)}>Keep box</button>
        <button type="button" disabled={busy} onClick={() => { void removeBox(selected); }}>Delete box and replies</button>
      </div> : <button type="button" className={styles.delete} disabled={busy}
        onClick={() => setConfirmDelete(selected.id)}>Delete this box…</button>}
    </> : <ul className={styles.boxes}>{boxes.map(box => <li key={box.id}>
      <button type="button" disabled={busy} onClick={() => { void openBox(box); }}>
        <span><strong>{box.title}</strong><small>{dateLabel(box.createdAt)}</small></span>
        <b>{box.count} {box.count === 1 ? "reply" : "replies"}</b>
      </button>
    </li>)}</ul>}
  </div>;
}
