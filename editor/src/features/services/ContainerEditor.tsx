import { ContainerAssistant } from "./ContainerAssistant";
import { useState } from "react";
import {
  parseServiceDraftContent,
  parseServiceFilePath,
} from "../../../../packages/pvo-assistant/services/index.js";
import { useContainerDraft } from "./useContainerDraft";
import styles from "./ServicesPanel.module.css";

export function ContainerEditor({
  serviceId,
  ownerId,
}: {
  serviceId: string;
  ownerId: string;
}) {
  const session = useContainerDraft(serviceId, ownerId);
  const [selected, setSelected] = useState("");
  const [newPath, setNewPath] = useState("src/main.mjs");
  const [check, setCheck] = useState<string | null>(null);
  const { buffer, remote, busy, dirty, error } = session;
  const file =
    buffer?.content.files.find((item) => item.path === selected) ??
    buffer?.content.files[0];
  const pending = !!buffer?.pending;
  const conflict =
    !!buffer && !!remote && buffer.base.revision !== remote.revision;
  const addFile = () => {
    try {
      parseServiceFilePath(newPath);
      if (buffer?.content.files.some((item) => item.path === newPath))
        throw new Error("That file already exists. Select it to edit.");
      session.edit((value) => ({
        ...value,
        content: {
          ...value.content,
          files: [...value.content.files, { path: newPath, content: "" }],
        },
      }));
      setSelected(newPath);
      setCheck(null);
    } catch {
      setCheck("Use a unique .mjs file path under src/ or tests/.");
    }
  };
  const checkFields = () => {
    if (!buffer) return;
    try {
      parseServiceDraftContent({
        ...buffer.content,
        agreement: JSON.parse(buffer.agreementText),
      });
      setCheck(
        "Draft fields checked on this device. Code has not run; independent tests are still required before publishing.",
      );
    } catch (failure) {
      setCheck(
        failure instanceof Error
          ? failure.message
          : "Correct the draft fields before saving.",
      );
    }
  };
  return (
    <section className={styles.editor} aria-label="Container code editor">
      <h4>Code</h4>
      <p>
        Changes stay in your draft. Viewers keep using the published version.
      </p>
      {busy && <p role="status">Loading or saving draft…</p>}
      {error && <p role="alert">{error}</p>}
      {buffer && (
        <>
          <p role="status">
            {pending
              ? "Save result unconfirmed · edits retained"
              : dirty
                ? "Unpublished local edits · saved on this device when storage is available"
                : `Saved draft · revision ${buffer.base.revision}`}
          </p>
          <label>
            Name
            <input
              value={buffer.content.description}
              disabled={busy || pending}
              onChange={(event) =>
                session.edit((value) => ({
                  ...value,
                  content: {
                    ...value.content,
                    description: event.target.value,
                  },
                }))
              }
            />
          </label>
          <label>
            File
            <select
              value={file?.path ?? ""}
              disabled={busy || pending}
              onChange={(event) => setSelected(event.target.value)}
            >
              {!buffer.content.files.length && (
                <option value="">No files yet</option>
              )}
              {buffer.content.files.map((item) => (
                <option key={item.path} value={item.path}>
                  {item.path}
                </option>
              ))}
            </select>
          </label>
          {file && (
            <label>
              {file.path}
              <textarea
                className={styles.code}
                aria-label={`Code for ${file.path}`}
                value={file.content}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                disabled={busy || pending}
                onChange={(event) => {
                  setCheck(null);
                  session.edit((value) => ({
                    ...value,
                    content: {
                      ...value.content,
                      files: value.content.files.map((item) =>
                        item.path === file.path
                          ? { ...item, content: event.target.value }
                          : item,
                      ),
                    },
                  }));
                }}
              />
            </label>
          )}
          <div className={styles.actions}>
            <label>
              New file path
              <input
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
                placeholder="src/main.mjs"
                disabled={busy || pending}
              />
            </label>
            <button type="button" disabled={busy || pending} onClick={addFile}>
              Add file
            </button>
          </div>
          <details>
            <summary>Entry point, tests and behavior agreement</summary>
            <label>
              Entry point
              <input
                value={buffer.content.entrypoint}
                disabled={busy || pending}
                onChange={(event) =>
                  session.edit((value) => ({
                    ...value,
                    content: {
                      ...value.content,
                      entrypoint: event.target.value,
                    },
                  }))
                }
              />
            </label>
            <label>
              Test files, one per line
              <textarea
                value={buffer.content.tests.join("\n")}
                disabled={busy || pending}
                onChange={(event) =>
                  session.edit((value) => ({
                    ...value,
                    content: {
                      ...value.content,
                      tests: event.target.value.split("\n").filter(Boolean),
                    },
                  }))
                }
              />
            </label>
            <label>
              Behavior agreement (JSON)
              <textarea
                className={styles.code}
                value={buffer.agreementText}
                spellCheck={false}
                disabled={busy || pending}
                onChange={(event) =>
                  session.edit((value) => ({
                    ...value,
                    agreementText: event.target.value,
                  }))
                }
              />
            </label>
            <p>
              The agreement defines inputs, results and expected behavior.
              Changing it requires fresh independent tests.
            </p>
          </details>
          {conflict && (
            <div>
              <p>
                A newer revision is saved. Your local edits are preserved.
                Compare it before choosing which version to keep.
              </p>
              <details>
                <summary>
                  View newer saved draft · revision {remote!.revision}
                </summary>
                <pre className={styles.preview}>
                  {JSON.stringify(remote!.content, null, 2)}
                </pre>
              </details>
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={busy || pending}
                  onClick={() => void session.reapply()}
                >
                  Save my edits over the reviewed revision
                </button>
                <button
                  type="button"
                  disabled={busy || pending}
                  onClick={session.useSaved}
                >
                  Discard local edits and use saved draft
                </button>
              </div>
            </div>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              disabled={busy || (!dirty && !pending) || (conflict && !pending)}
              onClick={() => void session.save()}
            >
              {pending ? "Retry saved action" : "Save draft"}
            </button>
            <button
              type="button"
              disabled={busy || pending}
              onClick={checkFields}
            >
              Check draft fields on device
            </button>
          </div>
          {check && <p role="status">{check}</p>}
          <ContainerAssistant
            draft={buffer.base}
            disabled={busy || dirty || pending || conflict}
            refresh={() => void session.refresh()}
          />
        </>
      )}
    </section>
  );
}
