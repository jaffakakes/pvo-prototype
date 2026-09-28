import { useEffect, useRef, useState } from "react";
import type { Publication } from "../../domain/publishing/model";
import type { PublishingClient } from "../../infrastructure/publishing/client";
import { copyPublicationLink } from "../../infrastructure/publishing/nativeShare";
import { forgetExportPublication } from "../../state/export/exportArtifactStore";
import styles from "./SharePanel.module.css";

export function SharedVideos({ client }: { client: PublishingClient }) {
  const [items, setItems] = useState<Publication[]>([]);
  const [busy, setBusy] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const load = async () => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setFailure(null);
    try {
      const publications = await client.list(controller.signal);
      if (!controller.signal.aborted && mounted.current) setItems(publications);
    } catch {
      if (!controller.signal.aborted && mounted.current) setFailure("Couldn't load shared videos.");
    } finally { if (mounted.current && active.current === controller) { active.current = null; setBusy(false); } }
  };
  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; active.current?.abort(); };
  }, [client]);
  const remove = async (item: Publication) => {
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setFailure(null);
    // A cancelled response cannot prove that deletion did not commit. Stop presenting this link as ready now.
    forgetExportPublication(item.id, crypto.randomUUID());
    try {
      await client.remove(item.id, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setItems(previous => previous.filter(value => value.id !== item.id));
      setRemoving(null);
    } catch {
      if (!controller.signal.aborted && mounted.current) setFailure("Couldn't delete this link. Try again.");
    } finally { if (mounted.current && active.current === controller) { active.current = null; setBusy(false); } }
  };
  return <section className={styles.library} aria-label="Shared videos">
    <div className={styles.sectionHeading}><h3>Shared videos</h3><button type="button" disabled={busy} onClick={() => { void load(); }}>Refresh</button></div>
    {busy && <p role="status">Loading…</p>}
    {failure && <p className={styles.error} role="alert">{failure}</p>}
    {!busy && !items.length && !failure && <p>No shared videos yet.</p>}
    <ul>{items.map(item => <li key={item.id}>
      <div><strong>{item.title}</strong><small>{item.format === "pvo" ? "Interactive" : "Video"} · {new Date(item.createdAt).toLocaleDateString()}</small></div>
      {removing === item.id ? <div className={styles.confirm}>
        <p>Delete this link? New viewers won't be able to open it.</p>
        <button type="button" disabled={busy} onClick={() => setRemoving(null)}>Keep link</button>
        <button type="button" disabled={busy} onClick={() => { void remove(item); }}>Delete link</button>
      </div> : <div className={styles.smallActions}>
        <button type="button" disabled={busy} onClick={() => {
          void copyPublicationLink(item.url).then(() => { if (mounted.current) setCopied(item.id); })
            .catch(() => { if (mounted.current) setFailure("Couldn't copy the link."); });
        }}>{copied === item.id ? "Copied" : "Copy link"}</button>
        <button type="button" disabled={busy} onClick={() => setRemoving(item.id)}>Delete</button>
      </div>}
    </li>)}</ul>
  </section>;
}
