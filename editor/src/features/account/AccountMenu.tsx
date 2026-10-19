import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  useAuthGate,
  openSignIn,
  setAuthError,
} from "../../state/auth/authGateStore";
import { signOutCurrentAccount } from "../../state/auth/accountCommands";
import {
  refreshProfile,
  updateProfile,
  useAccountProfile,
} from "../../state/account/accountProfileStore";
import { useCapture } from "../../state/captureStore";
import { useHeaderPopover } from "../../ui/useHeaderPopover";
import { Icon } from "../../ui/Icon";
import { AppearanceSettings } from "../settings/EditorPreferencesSettings";
import { AccountIcon } from "./AccountIcon";
import styles from "./AccountMenu.module.css";

const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function initial(name: string, email: string | null) {
  return (
    segments
      .segment(name.trim() || email?.split("@")[0] || "?")
      [Symbol.iterator]()
      .next().value?.segment ?? "?"
  ).toLocaleUpperCase();
}

export function AccountMenu() {
  const user = useAuthGate((state) => state.user);
  return user ? <SignedInMenu key={user.id} name={user.name} /> : null;
}

function SignedInMenu({ name: accountName }: { name: string }) {
  const { trigger, panel, position, open, close } = useHeaderPopover(
    268,
    "end",
  );
  const { profile, loading, saving, error } = useAccountProfile();
  const [view, setView] = useState<"menu" | "profile" | "theme">("menu");
  const [name, setName] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const id = useId();
  const localId = useCapture((state) => state.localId);
  const screen = useCapture((state) => state.screen);
  const displayName = profile?.name ?? accountName;
  const photo = profile?.photo;
  const avatar = photo ? (
    <img src={photo} alt="" />
  ) : (
    initial(displayName, profile?.email ?? null)
  );
  useEffect(() => {
    void refreshProfile();
  }, []);
  useEffect(() => {
    close();
  }, [localId, screen, close]);
  useEffect(() => {
    if (position && view !== "menu")
      panel.current?.querySelector<HTMLElement>("input, button")?.focus();
  }, [view, position, panel]);
  const choosePhoto = () => file.current?.click();
  const dismiss = () => close(true);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    } else if (
      view === "menu" &&
      ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
    ) {
      event.preventDefault();
      const items = [
        ...event.currentTarget.querySelectorAll<HTMLElement>(
          '[role="menuitem"]',
        ),
      ];
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length;
      items[next]?.focus();
    }
  };
  const signOut = async () => {
    setSigningOut(true);
    try {
      await signOutCurrentAccount();
      close();
    } catch (cause) {
      close();
      openSignIn();
      setAuthError(
        cause instanceof Error
          ? cause.message
          : "Couldn't sign out. Try again.",
      );
    } finally {
      setSigningOut(false);
    }
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.avatar}
        aria-label={`Account · ${displayName}`}
        aria-haspopup="menu"
        aria-expanded={!!position}
        aria-controls={position ? id : undefined}
        onClick={() => {
          if (position) {
            dismiss();
            return;
          }
          setView("menu");
          useCapture
            .getState()
            .patch({ playing: false, sheet: null, orb: false });
          open();
        }}
      >
        {avatar}
      </button>
      <input
        ref={file}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        hidden
        aria-label="Profile photo"
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (selected) void updateProfile({ file: selected });
        }}
      />
      {position &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role={view === "menu" ? "menu" : "dialog"}
            aria-label={
              view === "menu"
                ? "Account"
                : view === "profile"
                  ? "Edit profile"
                  : "Change theme"
            }
            className={styles.panel}
            style={{
              ...position,
              maxHeight: `calc(100dvh - ${position.top + 12}px)`,
            }}
            onKeyDown={onKeyDown}
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                !event.currentTarget.contains(event.relatedTarget) &&
                event.relatedTarget !== trigger.current
              )
                close();
            }}
          >
            {view === "menu" ? (
              <>
                <div className={styles.band} role="presentation">
                  <button
                    type="button"
                    className={`${styles.avatar} ${styles.bigAvatar}`}
                    aria-label={photo ? "Change profile photo" : "Add a photo"}
                    disabled={loading || saving || !profile}
                    onClick={choosePhoto}
                    aria-busy={saving}
                  >
                    {avatar}
                    {!photo && (
                      <span className={styles.badge}>
                        <Icon name="plus" size={11} />
                      </span>
                    )}
                  </button>
                  <div className={styles.who}>
                    <span className={styles.name}>{displayName}</span>
                    {profile?.email && (
                      <span className={styles.email} title={profile.email}>
                        {profile.email}
                      </span>
                    )}
                    {!photo && (
                      <button
                        type="button"
                        className={styles.addPhoto}
                        disabled={loading || saving || !profile}
                        onClick={choosePhoto}
                      >
                        {saving ? "Uploading…" : "Add a photo"}
                      </button>
                    )}
                  </div>
                </div>
                <div className={styles.items} role="presentation">
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.item}
                    onClick={() => {
                      setName(displayName);
                      setView("profile");
                    }}
                  >
                    <AccountIcon kind="person" />
                    Edit profile
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.item}
                    onClick={() => setView("theme")}
                  >
                    <span className={styles.swatch} />
                    Change theme
                    <span className={styles.chevron}>
                      <AccountIcon kind="chevron" />
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.item}
                    aria-disabled="true"
                    title="Invite link not set yet"
                  >
                    <AccountIcon kind="discord" />
                    Join our Discord
                  </button>
                  <a
                    role="menuitem"
                    className={styles.item}
                    href="mailto:support@getrestyle.app"
                    onClick={dismiss}
                  >
                    <AccountIcon kind="info" />
                    Help &amp; support
                  </a>
                  <div className={styles.divider} role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className={`${styles.item} ${styles.danger}`}
                    disabled={signingOut}
                    onClick={() => void signOut()}
                  >
                    <AccountIcon kind="logout" />
                    {signingOut ? "Signing out…" : "Sign out"}
                  </button>
                </div>
              </>
            ) : (
              <div className={styles.details}>
                <div className={styles.detailHeading}>
                  <button
                    type="button"
                    aria-label="Back to account menu"
                    onClick={() => {
                      setView("menu");
                      requestAnimationFrame(() =>
                        panel.current
                          ?.querySelector<HTMLElement>('[role="menuitem"]')
                          ?.focus(),
                      );
                    }}
                  >
                    <Icon name="back" size={18} />
                  </button>
                  <strong>
                    {view === "profile" ? "Edit profile" : "Change theme"}
                  </strong>
                  <button
                    type="button"
                    aria-label="Close account menu"
                    onClick={dismiss}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
                {view === "theme" ? (
                  <AppearanceSettings iconOnly />
                ) : (
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (await updateProfile({ name })) dismiss();
                    }}
                  >
                    <button
                      type="button"
                      className={styles.photoEdit}
                      onClick={choosePhoto}
                      disabled={loading || saving || !profile}
                    >
                      <span className={`${styles.avatar} ${styles.bigAvatar}`}>
                        {avatar}
                      </span>
                      <span>{photo ? "Change photo" : "Add a photo"}</span>
                    </button>
                    <label className={styles.field}>
                      Name
                      <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        maxLength={120}
                        required
                        autoComplete="name"
                      />
                    </label>
                    {profile?.email && (
                      <p className={styles.profileEmail}>{profile.email}</p>
                    )}
                    <button
                      type="submit"
                      className={styles.save}
                      disabled={saving || loading || !profile || !name.trim()}
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </form>
                )}
              </div>
            )}
            {error && (
              <div className={styles.error} role="status">
                {error}
                {!profile && (
                  <button type="button" onClick={() => void refreshProfile()}>
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>,
          document.querySelector(".app") ?? document.body,
        )}
    </>
  );
}
