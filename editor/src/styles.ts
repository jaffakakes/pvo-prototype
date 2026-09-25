import styles from "./Capture.module.css";

// Keep readable class hooks for the editor's pointer interactions and browser tests.
// Visual rules are scoped by the CSS Module's generated class names.
export function cx(value: string) {
  return value.split(" ").map(name => styles[name] ? `${styles[name]} ${name}` : name).join(" ");
}
