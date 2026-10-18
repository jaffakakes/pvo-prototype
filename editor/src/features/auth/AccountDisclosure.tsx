type Props = { className?: string };

export function AccountDisclosure({ className }: Props) {
  return <p className={className}>
    Supabase manages email and Google sign-in. Google shares your email, name and account identifier.
    Restyle stores an account ID and display name to own your published links. Your editable projects stay in this browser. Read our{" "}
    <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a> and{" "}
    <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms of Service</a>.
  </p>;
}
