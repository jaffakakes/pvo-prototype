import styles from "../GhostFrame.module.css";

export function ChoiceHint() {
  return <span className={styles.choice}>
    <i className={styles.choicePrompt} />
    <span className={styles.choiceOptions}><b /><b /></span>
  </span>;
}
