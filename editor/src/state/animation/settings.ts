import { create } from "zustand";

type AnimationSettings = {
  laneMode: "properties" | "single";
  pathDots: boolean;
  setLaneMode(mode: "properties" | "single"): void;
  setPathDots(visible: boolean): void;
};

/** Presentation preferences are independent of authored curves and project Undo. */
export const useAnimationSettings = create<AnimationSettings>(set => ({
  laneMode: "properties", pathDots: true,
  setLaneMode: laneMode => set({ laneMode }),
  setPathDots: pathDots => set({ pathDots }),
}));
