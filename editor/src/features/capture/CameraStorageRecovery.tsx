import { useSyncExternalStore } from "react";
import {
  getProjectStorageStatus,
  subscribeProjectStorage,
} from "../../app/projectAutosave";
import { ProjectStorageStatus } from "../settings/ProjectStorageStatus";
import styles from "./CameraStorageRecovery.module.css";

/** Keeps storage recovery reachable on Camera after its notification is dismissed. */
export function CameraStorageRecovery() {
  const status = useSyncExternalStore(subscribeProjectStorage, getProjectStorageStatus);
  const needsAttention = status.phase === "restore-failed" || status.phase === "retrying"
    || status.storage.phase === "error";
  if (!needsAttention) return null;

  return <details className={styles.recovery}>
    <summary>Storage options</summary>
    <ProjectStorageStatus onlyIssues />
  </details>;
}
