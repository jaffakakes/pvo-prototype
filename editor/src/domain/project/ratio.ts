import type { Ratio } from "./model";
import { canvasPixelSize } from "../../../../packages/pvo-component-runtime/index.js";

export const RATIOS: Record<Ratio, [
  number,
  number
]> = { "9:16": [9, 16], "1:1": [1, 1], "4:5": [4, 5], "16:9": [16, 9] };
export const projectRatio = (ratio: Ratio): [
  number,
  number
] => RATIOS[ratio];

export const projectCanvasSize = (ratio: Ratio) => canvasPixelSize(...projectRatio(ratio));
