import { useCallback, useEffect, useRef, useState } from "react";
import { total } from "../../domain/clips/timing";
import { projectRatio } from "../../domain/project/ratio";
import { sceneRouteLabel } from "../../domain/scenes/references";
import { useWideLayout } from "../../infrastructure/viewport";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import { RatioMenu } from "../../ui/RatioMenu";
import { fmt } from "../../ui/formatTime";
import { SOUNDS } from "../sound/catalog";
import { CaptureRecovery } from "./CaptureRecovery";
import { CameraStorageRecovery } from "./CameraStorageRecovery";
import recoveryStyles from "./CaptureRecovery.module.css";
import { ShutterControls } from "./ShutterControls";
import { getCameraStream, useCamera } from "./useCamera";
import { useCameraControls } from "./useCameraControls";
import { useCameraFlash } from "./useCameraFlash";
import flashStyles from "./CameraFlash.module.css";
import { useRecorder } from "./useRecorder";
import { importVideos } from "./videoImport";

export function Camera() {
  const s = useCapture();
  const wide = useWideLayout();
  const {
    videoRef,
    freezeRef,
    freezeVisible,
    startCam,
    cameraStatus,
    cameraTrack,
    releaseCamera,
    microphoneAvailable,
  } = useCamera();
  const { onShutterDown, onShutterUp, stopRec, capturing } = useRecorder();
  const releaseFailedFlash = useCallback(
    (track: MediaStreamTrack) => {
      // Finalize this camera's footage before releasing a torch that will not stop.
      if (getCameraStream()?.getVideoTracks()[0] === track) stopRec();
      releaseCamera(track);
    },
    [stopRec, releaseCamera],
  );
  const { flashAvailable, screenFlash, toggleFlash } = useCameraFlash(
    cameraTrack,
    capturing,
    s.facing,
    releaseFailedFlash,
  );
  const uploadRef = useRef<HTMLInputElement>(null);
  const viewfinderRef = useRef<HTMLDivElement>(null);
  const [viewfinderSize, setViewfinderSize] = useState({ width: 0, height: 0 });
  const { displayCameraStatus, cameraPending, removeLast, flip, startOver } =
    useCameraControls(cameraStatus, startCam);
  const activeClips = s.clips.filter((c) => c.id !== s.replacing);
  const used = total(activeClips);
  const live = s.recording ? s.elapsed : 0;
  const last = s.clips.at(-1);
  const count = s.clips.length;
  const recordingScene = s.recordingInto
    ? s.scenes.find((scene) => scene.id === s.recordingInto)
    : null;
  const linkedLabel = recordingScene
    ? sceneRouteLabel(s.scenes, recordingScene.id)
    : null;
  const [rw, rh] = projectRatio(s.ratio);
  const viewAspect = viewfinderSize.width / viewfinderSize.height;
  const frameAspect = rw / rh;
  const orientationFits =
    viewfinderSize.width > 0 &&
    viewfinderSize.height > 0 &&
    ((frameAspect < 1 && viewAspect < 1) ||
      (frameAspect > 1 && viewAspect > 1) ||
      (frameAspect === 1 && Math.abs(viewAspect - 1) < 0.1));
  const frameWidth = Math.min(
    viewfinderSize.width,
    (viewfinderSize.height * rw) / rh,
  );
  const frameHeight = (frameWidth * rh) / rw;
  const frameStyle =
    orientationFits || !viewfinderSize.width || !viewfinderSize.height
      ? { width: "100%", height: "100%" }
      : { width: frameWidth, height: frameHeight };
  useEffect(() => {
    const viewfinder = viewfinderRef.current;
    if (!viewfinder) return;
    const resize = () =>
      setViewfinderSize({
        width: viewfinder.clientWidth,
        height: viewfinder.clientHeight,
      });
    const observer = new ResizeObserver(resize);
    observer.observe(viewfinder);
    resize();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.code !== "Space" ||
        event.repeat ||
        useCapture.getState().sheet ||
        useCapture.getState().importing ||
        cameraPending
      )
        return;
      const target = event.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      )
        return;
      event.preventDefault();
      onShutterDown({ button: 0 });
      onShutterUp();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [cameraPending, onShutterDown, onShutterUp]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    await importVideos(Array.from(files));
    if (uploadRef.current) uploadRef.current.value = "";
  };

  const hint = s.countdown
    ? "Tap to cancel"
    : s.recording
      ? "Release or tap to stop"
      : s.replacing != null
        ? "Record the new take"
        : recordingScene && !count
          ? `Record or upload the first take for ${recordingScene.name}`
          : count
            ? "Tap or hold to add another clip"
            : "Tap or hold to record";
  const fallbackTitle =
    displayCameraStatus === "starting" ? "Starting camera…" : "Camera is off";
  const showFallback =
    displayCameraStatus === "starting" || displayCameraStatus === "unavailable";

  return (
    <>
      <div
        className={`${cx("camWrap")} ${screenFlash ? flashStyles.illuminated : ""}`}
      >
        {screenFlash && (
          <div
            className={flashStyles.screenLight}
            data-screen-flash="true"
            aria-hidden="true"
          />
        )}
        <div ref={viewfinderRef} className={cx("viewfinder")}>
          <div
            className={cx("cameraFrame")}
            data-ratio={s.ratio}
            data-fill={orientationFits}
            style={frameStyle}
          >
            <video
              ref={videoRef}
              className={cx("live")}
              muted
              playsInline
              controls={false}
              disablePictureInPicture
              disableRemotePlayback
              aria-hidden="true"
              tabIndex={-1}
              style={{
                transform: s.facing === "user" ? "scaleX(-1)" : undefined,
              }}
            />
            <canvas
              ref={freezeRef}
              className={cx("flipFreeze")}
              data-visible={freezeVisible}
              aria-hidden="true"
            />
          </div>
          {showFallback && (
            <>
              <div
                className={cx("fallback")}
                role={cameraPending ? "status" : undefined}
                aria-live={cameraPending ? "polite" : undefined}
              >
                <span
                  className={cx("fallbackIco")}
                  data-launch-splash-hidden="true"
                >
                  <Icon name="camera" size={30} />
                </span>
                <h2 data-launch-splash-hidden="true">{fallbackTitle}</h2>
                <p data-launch-splash-hidden="true">
                  {cameraPending
                    ? "Getting your camera ready."
                    : "Allow access to record, or tap the shutter to make demo clips."}
                </p>
                {!cameraPending && (
                  <button
                    className={cx("press")}
                    data-launch-splash-hidden="true"
                    onClick={() => {
                      void startCam();
                    }}
                  >
                    Allow camera
                  </button>
                )}
              </div>
              <div
                className={cx("cameraGuide")}
                data-ratio={s.ratio}
                data-fill={orientationFits}
                style={frameStyle}
                aria-hidden="true"
              />
            </>
          )}
          <div className={cx("topScrim")} />
          <div className={cx("camTop")}>
            <div className={cx("recLine")}>
              {s.recording && (
                <span className={cx("recPill")}>
                  <i />
                  REC {fmt(live)}
                </span>
              )}
              <span className={cx("timeNote")}>{fmt(used + live)}</span>
            </div>
          </div>
          <div className={cx("camControls")}>
            <button
              className={cx("sq42")}
              onClick={startOver}
              aria-label="Start over"
              title="Start over"
              disabled={
                s.importing ||
                s.recording ||
                (!count && s.replacing == null && !s.recordingInto)
              }
              style={{ opacity: !count && s.replacing == null ? 0.5 : 1 }}
            >
              <Icon name="close" />
            </button>
            {wide && (
              <button
                className={cx("soundPill")}
                onClick={() => s.patch({ sheet: "sound" })}
              >
                <Icon name="music" size={15} />{" "}
                <span>{s.sound ? SOUNDS[s.sound].name : "Add sound"}</span>
              </button>
            )}
            <button
              className={cx("sq42 flipButton")}
              data-switching={displayCameraStatus === "switching"}
              onClick={flip}
              disabled={cameraPending || s.recording}
              aria-label="Flip camera"
              title="Flip camera"
            >
              <Icon name="flip" />
            </button>
          </div>
          <div className={cx("rightRail")}>
            {flashAvailable && (
              <button
                className={cx("rail")}
                data-on={s.flash}
                onClick={toggleFlash}
                disabled={cameraPending}
                aria-label="Flash"
                aria-pressed={s.flash}
                title="Flash when recording"
              >
                <Icon name="flash" size={18} />
              </button>
            )}
            <button
              className={cx("rail")}
              data-on={s.timer > 0}
              onClick={() => {
                if (s.recording) return;
                const timer = s.timer === 0 ? 3 : s.timer === 3 ? 10 : 0;
                s.patch({ timer });
              }}
              aria-label="Timer"
              title="Timer"
            >
              <Icon name="timer" size={18} />
              {s.timer > 0 && (
                <span className={cx("railBadge")}>{s.timer}s</span>
              )}
            </button>
            <button
              className={cx("rail")}
              data-on={s.speedRow || s.recSpeed !== 1}
              onClick={() => {
                if (!s.recording) s.patch({ speedRow: !s.speedRow });
              }}
              aria-label="Speed"
              title="Speed"
            >
              <Icon name="speed" size={18} />
            </button>
            <div className={cx("railAnchor")}>
              <button
                className={cx("rail railRatio")}
                data-on={s.ratioMenu}
                onClick={() => s.patch({ ratioMenu: !s.ratioMenu })}
                aria-label="Ratio"
                aria-description={`Selected: ${s.ratio}`}
                aria-haspopup="menu"
                aria-expanded={s.ratioMenu}
                title="Ratio"
              >
                <Icon name="ratio" size={17} />
                <strong className={cx("railRatioValue")}>{s.ratio}</strong>
                <Icon name="down" size={13} />
              </button>
              <RatioMenu place="rail" />
            </div>
          </div>
          {recordingScene && (
            <div className={cx("sceneBanner")}>
              <span>
                {recordingScene.name}
                {linkedLabel ? ` · plays after “${linkedLabel}”` : ""}
              </span>
              <button
                onClick={() => s.cancelRecordingIntoScene()}
                aria-label="Leave scene camera"
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          )}
          {s.replacing != null && (
            <div className={cx("replacing")}>
              Replacing clip{" "}
              {s.clips.findIndex((c) => c.id === s.replacing) + 1}
              <button
                onClick={() => s.patch({ replacing: null, screen: "editor" })}
                aria-label="Cancel replace"
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          )}
          {!!last && !s.recording && s.replacing == null && (
            <button
              className={cx("dock")}
              onClick={() =>
                s.patch({
                  screen: "editor",
                  recordingInto: null,
                  sel: -1,
                  t: 0,
                })
              }
              aria-label="Open editor"
            >
              <span
                className={cx("dockThumb")}
                style={{ background: last.color }}
              >
                {last.url && (
                  <video
                    src={`${last.url}#t=${last.in.toFixed(1)}`}
                    muted
                    playsInline
                    style={{
                      objectFit: last.fit,
                      transform: last.mirror ? "scaleX(-1)" : undefined,
                    }}
                  />
                )}
                <span className={cx("dockEdit")}>EDIT</span>
                <span className={cx("dockCount")}>{count}</span>
              </span>
              <span className={cx("dockCaption")}>Open editor</span>
            </button>
          )}
          <ShutterControls
            cameraPending={cameraPending}
            cameraStatus={cameraStatus}
            microphoneAvailable={microphoneAvailable}
            hint={hint}
            removeLast={removeLast}
            onUpload={() => uploadRef.current?.click()}
            onShutterDown={onShutterDown}
            onShutterUp={onShutterUp}
          />
          {s.countdown > 0 && (
            <div className={cx("countdown")} aria-live="assertive">
              {s.countdown}
            </div>
          )}
        </div>
      </div>
      <footer className={cx("camFoot")}>
        <span className={cx("brand")}>
          <span className={cx("brandMark")}>
            <img src="restyle-mark.png" alt="" />
          </span>
          <span>restyle</span>
        </span>
        <span>
          {recordingScene ? `${recordingScene.name} · ` : ""}
          {count
            ? `${count} clip${count === 1 ? "" : "s"} · ${fmt(total(s.clips))}`
            : "No clips yet"}
        </span>
      </footer>
      <div className={recoveryStyles.camera}>
        <CaptureRecovery />
        <CameraStorageRecovery />
      </div>
      <input
        ref={uploadRef}
        type="file"
        accept="video/*"
        multiple
        hidden
        disabled={s.importing}
        onChange={(e) => {
          void upload(e.target.files);
        }}
      />
    </>
  );
}
