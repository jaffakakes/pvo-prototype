import { useEffect, useState } from "react";
import { createFontScope, type AppliedFont } from "../../../../packages/pvo-fonts/index.js";

/** Font loading belongs to the mounted preview, including canvas repaint after decoding. */
export function useAppliedFont(font: AppliedFont | undefined) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!font) return;
    const scope = createFontScope();
    let active = true;
    void scope.load(font).then(() => {
      if (active) setRevision(value => value + 1);
    }).catch(error => { if (active) console.error(`Preview font ${font.id} could not load:`, error); });
    return () => { active = false; scope.dispose(); };
  }, [font]);
  return revision;
}
