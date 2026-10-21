import { signOutSupabase } from "../../infrastructure/auth/supabase";
import { signOutAccount, useAuthGate } from "./authGateStore";

export async function signOutCurrentAccount() {
  const { supabasePublishableKey, supabaseUrl } = useAuthGate.getState();
  await signOutAccount();
  if (!supabasePublishableKey || !supabaseUrl) return;
  try {
    await signOutSupabase(supabaseUrl, supabasePublishableKey);
  } catch {
    throw new Error(
      "Restyle signed out, but the sign-in session could not be cleared. Try again later.",
    );
  }
}
