import styles from "../GhostFrame.module.css";

export function CardHint() {
  return <span className={styles.cardHint}>
    <i className={styles.cardTitle} />
    <i className={styles.cardBody} />
    <span className={styles.cardActions}><b /><b /></span>
  </span>;
}
