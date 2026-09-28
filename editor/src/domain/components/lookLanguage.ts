import type { PvoComponent } from "../project/model";
import { componentLook } from "./look";
import { lookStyleSource } from "./languageLookValues";

/** Generate only the bounded visual properties supported by PVO Style. */
export function componentLookLanguage(component: PvoComponent): string {
  return lookStyleSource(component, componentLook(component));
}
