import styles from "../GhostFrame.module.css";

export function RouteHint() {
  return <span className={styles.route}>
    <i className={styles.routeCurrent} />
    <span className={styles.routeBranch}><b /><i /></span>
    <span className={styles.routeBranch}><b /><i /></span>
  </span>;
}
