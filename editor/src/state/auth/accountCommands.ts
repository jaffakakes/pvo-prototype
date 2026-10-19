import { signOutClerk } from "../../infrastructure/auth/clerk";
import { signOutAccount, useAuthGate } from "./authGateStore";

export async function signOutCurrentAccount() {
  const { clerkPublishableKey } = useAuthGate.getState();
  await signOutAccount();
  if (!clerkPublishableKey) return;
  try {
    await signOutClerk(clerkPublishableKey);
  } catch {
    throw new Error(
      "Restyle signed out, but the sign-in session could not be cleared. Try again later.",
    );
  }
}
