type Props = { className?: string };

export function AccountDisclosure({ className }: Props) {
  return (
    <p className={className}>
      By continuing you agree to the{" "}
      <a href="/terms.html" target="_blank" rel="noopener noreferrer">
        Terms
      </a>{" "}
      and{" "}
      <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
        Privacy Policy
      </a>
      .{" "}
      <a href="/privacy.html#sign-in" target="_blank" rel="noopener noreferrer">
        What we share ›
      </a>
    </p>
  );
}
