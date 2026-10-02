import styles from "../GhostFrame.module.css";

export function JumpHint() {
  return <span className={styles.jump}>
    <span className={styles.jumpTip}><b /><i /></span>
    <span className={styles.jumpTrack}><i /><b /><em /></span>
  </span>;
}
