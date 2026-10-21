export function TextToolIcon({
  name,
}: {
  name: "font" | "background" | "designs" | "keyboard";
}) {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "font" && (
        <path d="M7 27 15 5h3l8 22M10 20h13M4 27h9M21 27h8M12 5h8" />
      )}
      {(name === "background" || name === "designs") && (
        <>
          <rect x="5" y="4" width="22" height="24" rx="3" />
          <path
            d={
              name === "background"
                ? "M10 23 15 9h2l5 14M12 18h8"
                : "M9 23 13 10l4 13M10.5 18h5"
            }
          />
          {name === "designs" && <path d="m18 10 4 13m0-13 3 10" />}
        </>
      )}
      {name === "keyboard" && (
        <>
          <rect x="3" y="4" width="26" height="19" rx="3" />
          <path d="M8 9h1m6 0h2m6 0h1M8 14h1m6 0h2m6 0h1M10 19h12M12 27l4 3 4-3" />
        </>
      )}
    </svg>
  );
}
