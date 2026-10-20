import { getSupabase } from "./supabase";

export function googleCallbackUrl(): string {
  const url = new URL("/editor/", location.origin);
  url.searchParams.set("auth", "google");
  return url.href;
}

export async function googleAuthorizationUrl(
  projectUrl: string,
  publishableKey: string,
): Promise<string> {
  const provider = await getSupabase(projectUrl, publishableKey);
  const { data, error } = await provider.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: googleCallbackUrl(),
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url)
    throw new Error("Google sign-in couldn't start. Try again.");
  const destination = new URL(data.url);
  if (
    destination.origin !== projectUrl ||
    destination.pathname !== "/auth/v1/authorize"
  )
    throw new Error("Google sign-in returned an invalid address.");
  return destination.href;
}
