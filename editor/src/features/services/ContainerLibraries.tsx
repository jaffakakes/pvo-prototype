import {
  nodeLibraryIds,
  resolveNodeLibraries,
  supportedNodeLibraries,
  type NodeLibrary,
} from "../../../../packages/pvo-assistant/services/index.js";
import styles from "./ServicesPanel.module.css";

const choices = supportedNodeLibraries().map(({ name, version }) => ({
  id: `${name}@${version}`,
  label: `${name} ${version}`,
}));

/** Selection changes the existing saved draft; it never installs packages or starts compute. */
export function ContainerLibraries({
  dependencies,
  disabled,
  onChange,
}: {
  dependencies: NodeLibrary[];
  disabled: boolean;
  onChange: (dependencies: NodeLibrary[]) => void;
}) {
  const selected = nodeLibraryIds(dependencies);
  return (
    <fieldset className={styles.libraries} disabled={disabled}>
      <legend>Libraries</legend>
      <p>
        Choose the libraries your code imports. Changing this selection requires
        fresh tests before publishing.
      </p>
      {choices.map(({ id, label }) => (
        <label className={styles.libraryOption} key={id}>
          <input
            type="checkbox"
            checked={selected.includes(id)}
            onChange={(event) =>
              onChange(
                resolveNodeLibraries(
                  event.target.checked
                    ? [...selected, id]
                    : selected.filter((value) => value !== id),
                ),
              )
            }
          />
          {label}
        </label>
      ))}
      <p>The same approved version is used for testing and hosting.</p>
    </fieldset>
  );
}
