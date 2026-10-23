import { useEffect, useState } from "react";
import styles from "./AssistantWorkingStatus.module.css";

const words = [
  "Noodling",
  "Bamboozling",
  "Pixel wrangling",
  "Concocting",
  "Booping",
  "Marinating",
  "Razzle-dazzling",
  "Doodling",
  "Percolating",
  "Smooshing",
  "Hocus-pocusing",
  "Whisking",
];

/** Mounted only for a pending exchange, so its timer ends with the request. */
export function AssistantWorkingStatus({
  progress,
  showLogo,
}: {
  progress: string;
  showLogo: boolean;
}) {
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * words.length),
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex(
        (previous) =>
          (previous + 1 + Math.floor(Math.random() * (words.length - 1))) %
          words.length,
      );
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className={styles.status}
      role="status"
      title={progress || undefined}
      data-assistant-working
    >
      {showLogo && (
        <span className={styles.logo} aria-hidden="true">
          <img src="restyle-mark.png" alt="" draggable={false} />
        </span>
      )}
      <span aria-hidden="true" data-working-word>
        {words[index]}…
      </span>
      <span className={styles.srOnly}>
        {progress || "Restyle is working on your request."}
      </span>
    </div>
  );
}
