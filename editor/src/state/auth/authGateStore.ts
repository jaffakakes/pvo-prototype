import { create } from "zustand";

type AuthGateState = { source: "signin" | null };
export const useAuthGate = create<AuthGateState>(() => ({ source: null }));

export function openSignIn() { useAuthGate.setState({ source: "signin" }); }
export function closeAuthGate() { useAuthGate.setState({ source: null }); }
