import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { fontFamily } from "../../../../packages/pvo-fonts/index.js";
import type { PvoComponent } from "../../domain/project/model";
import type { LookPart } from "../../domain/components/look";
import { ComponentFieldsView } from "../preview/ComponentFieldsView";
import { PvoRuntimeOverlay } from "../preview/PvoRuntimeOverlay";
import { useAppliedFont } from "../preview/useAppliedFont";
import { useComponentDimensions } from "../preview/useComponentDimensions";
import styles from "./ComponentStage.module.css";

const alwaysVisible = () => true;
const noResponse = () => {};

export function ComponentStage({
  component,
  part,
  onPart,
  badge,
}: {
  component: PvoComponent;
  part: LookPart;
  onPart(part: LookPart): void;
  badge?: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const { ref, size } = useComponentDimensions(component, 247);
  const [fit, setFit] = useState(1);
  useAppliedFont(component.font);
  useLayoutEffect(() => {
    const host = stage.current;
    const content = ref.current;
    if (!host || !content) return;
    const measure = () => {
      const width = Math.max(1, content.offsetWidth * size.width);
      const height = Math.max(1, content.offsetHeight * size.height);
      setFit(
        Math.max(
          0.1,
          Math.min(
            1.5,
            (host.clientWidth - 64) / width,
            (host.clientHeight - (host.clientHeight < 150 ? 24 : 96)) / height,
          ),
        ),
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [ref, size.width, size.height]);
  return (
    <section
      ref={stage}
      className={styles.stage}
      data-component-stage
      aria-label="Component preview"
    >
      <div
        className={styles.preview}
        style={{ transform: `translate(-50%, -50%) scale(${fit})` }}
      >
        <div
          ref={ref}
          data-component-stage-subject
          className={styles.renderer}
          style={
            {
              "--u": "1px",
              "--component-font": component.font
                ? `"${fontFamily(component.font)}"`
                : undefined,
              transform: `scale(${size.width}, ${size.height})`,
            } as CSSProperties
          }
        >
          {component.code?.custom ? (
            <PvoRuntimeOverlay
              component={component}
              width={247}
              trying={false}
              isVisible={alwaysVisible}
            />
          ) : (
            <ComponentFieldsView
              component={component}
              unit={1}
              trying={false}
              selectedPart={part}
              onSelectPart={onPart}
              onResponse={noResponse}
            />
          )}
        </div>
      </div>
      {badge && <div className={styles.logicBadge}>{badge}</div>}
    </section>
  );
}
