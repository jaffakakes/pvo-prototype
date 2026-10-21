import { useMemo, useState } from "react";
import { total } from "../../domain/clips/timing";
import { clampComponentStart } from "../../domain/components/timing";
import type { PvoComponent } from "../../domain/project/model";
import { useCapture } from "../../state/captureStore";
import { FramePicker } from "../frame-picker/FramePicker";

export function ComponentTimingPicker() {
  const component = useCapture((state) =>
    state.components.find((item) => item.id === state.selComp),
  );
  return component ? (
    <TimingDraft key={component.id} component={component} />
  ) : null;
}

function TimingDraft({ component }: { component: PvoComponent }) {
  const scene = useCapture((state) =>
    state.scenes.find((item) => item.id === component.sceneId),
  );
  const ratio = useCapture((state) => state.ratio);
  const [time, setTime] = useState(component.at);
  const length = total(scene?.clips ?? []);
  const at = clampComponentStart(time, component.dur, length);
  const previewScene = useMemo(
    () =>
      scene && {
        ...scene,
        components: scene.components.map((item) =>
          item.id === component.id ? { ...item, at } : item,
        ),
      },
    [scene, component.id, at],
  );
  if (!previewScene) return null;
  const close = () => useCapture.getState().patch({ sheet: null });
  return (
    <FramePicker
      scene={previewScene}
      ratio={ratio}
      time={at}
      maximum={clampComponentStart(
        Math.max(length, component.at, 0.5),
        component.dur,
        length,
      )}
      label="Choose component start"
      sliderLabel="Component appears at"
      closeLabel="Close timing picker"
      onTime={setTime}
      onSave={() => {
        useCapture.getState().updateComponent(component.id, { at });
        useCapture.getState().patch({ t: at, sheet: null });
      }}
      onClose={close}
    />
  );
}
