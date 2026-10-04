type Props = { className?: string };

export function AccountDisclosure({ className }: Props) {
  return <p className={className}>
    Google shares your name and account identifier with Restyle. Clerk handles email addresses,
    passwords, and verification; Restyle receives a Clerk account identifier. If you already use
    Google, connect email from Your account first to keep your published links together. Read our{" "}
    <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a> and{" "}
    <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms of Service</a>.
  </p>;
}
