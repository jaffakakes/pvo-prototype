type Kind = "person" | "info" | "logout" | "discord" | "chevron";
export function AccountIcon({ kind }: { kind: Kind }) {
  if (kind === "discord")
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="#5865F2"
        aria-hidden="true"
      >
        <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.24.5a14.6 14.6 0 0 1 4.3 1.4A16 16 0 0 0 4.5 4.9 14.6 14.6 0 0 1 8.8 3.5L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.6 9 .1 13.5.4 17.9a20 20 0 0 0 6 3l.5-.8a12 12 0 0 1-2-1c.17-.12.33-.25.49-.38a14.3 14.3 0 0 0 12.2 0c.16.13.32.26.5.38a12 12 0 0 1-2 1l.5.8a20 20 0 0 0 6-3c.4-5-.4-9.5-2.8-13.5zM8.5 15.3c-1.2 0-2.2-1.1-2.2-2.4S7.3 10.5 8.5 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4zm7 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4z" />
      </svg>
    );
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "chevron" && <path d="M9 6l6 6-6 6" />}
      {kind === "person" && (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
        </>
      )}
      {kind === "info" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01M11 12h1v4h1" />
        </>
      )}
      {kind === "logout" && (
        <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
      )}
    </svg>
  );
}
