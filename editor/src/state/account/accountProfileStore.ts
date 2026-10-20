import { create } from "zustand";
import {
  loadAccountProfile,
  saveAccountProfile,
  prepareAccountPhoto,
  type AccountProfile,
} from "../../infrastructure/account/profile";
import { useAuthGate } from "../auth/authGateStore";

type ProfileState = {
  profile: AccountProfile | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
};
export const useAccountProfile = create<ProfileState>(() => ({
  profile: null,
  loading: false,
  saving: false,
  error: null,
}));
let generation = 0;
useAuthGate.subscribe((state, previous) => {
  if (state.user?.id === previous.user?.id) return;
  generation++;
  useAccountProfile.setState({
    profile: null,
    loading: false,
    saving: false,
    error: null,
  });
});

export async function refreshProfile() {
  const owner = useAuthGate.getState().user;
  if (!owner || useAccountProfile.getState().loading) return;
  const version = generation;
  useAccountProfile.setState({ loading: true, error: null });
  try {
    const profile = await loadAccountProfile(useAuthGate.getState());
    if (generation !== version) return;
    if (profile.id !== owner.id) throw new Error("Account changed");
    useAccountProfile.setState({ profile });
  } catch {
    if (generation === version)
      useAccountProfile.setState({
        error: "Couldn't load your profile. Try again.",
      });
  } finally {
    if (generation === version) useAccountProfile.setState({ loading: false });
  }
}

export async function updateProfile(
  change: { name: string } | { file: File },
): Promise<boolean> {
  const current = useAccountProfile.getState();
  const owner = useAuthGate.getState().user;
  if (!owner || !current.profile || current.saving) return false;
  const version = ++generation;
  useAccountProfile.setState({ saving: true, error: null });
  try {
    const changes =
      "file" in change
        ? { photo: await prepareAccountPhoto(change.file) }
        : change;
    if (version !== generation) return false;
    const profile = await saveAccountProfile(useAuthGate.getState(), {
      ...current.profile,
      ...changes,
    });
    if (version !== generation || profile.id !== owner.id) return false;
    useAccountProfile.setState({ profile });
    return true;
  } catch {
    if (version === generation)
      useAccountProfile.setState({
        error:
          "file" in change
            ? "Couldn't upload photo. Try again."
            : "Couldn't save your name. Try again.",
      });
    return false;
  } finally {
    if (version === generation) useAccountProfile.setState({ saving: false });
  }
}
