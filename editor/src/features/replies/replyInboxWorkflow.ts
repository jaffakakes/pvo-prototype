import {
  RepliesHttpError,
  type CollectedReply,
  type ReplyBox,
  type RepliesClient,
} from "../../infrastructure/replies/client";

export type ReplyInboxState = {
  boxes: ReplyBox[];
  selectedId: string | null;
  replies: CollectedReply[] | null;
  message: string | null;
  emptySession: boolean;
  requiresSignIn: boolean;
  busy: boolean;
};

type Account = { available: boolean; userId: string | null };
type InboxAdapters = {
  client: Pick<RepliesClient, "listBoxes" | "listReplies" | "deleteBox">;
  account(): Account;
  refreshAccount(): Promise<Account>;
  requireAccount(): Promise<boolean>;
  changed(state: ReplyInboxState): void;
};

export function emptyReplyInbox(): ReplyInboxState {
  return {
    boxes: [],
    selectedId: null,
    replies: null,
    message: null,
    emptySession: false,
    requiresSignIn: false,
    busy: false,
  };
}

/** One request owns inbox feedback; replacing its owner invalidates every late result. */
export function createReplyInboxWorkflow(adapters: InboxAdapters) {
  let state = emptyReplyInbox();
  let active: AbortController | null = null;
  let accountId = adapters.account().userId;
  let disposed = false;

  const update = (patch: Partial<ReplyInboxState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    adapters.changed(state);
  };
  const cancel = () => {
    active?.abort();
    active = null;
  };
  const perform = async (
    fallback: string,
    action: (signal: AbortSignal, current: () => boolean) => Promise<void>,
    handleMissingSession = false,
  ) => {
    if (disposed) return;
    cancel();
    const controller = new AbortController();
    active = controller;
    const current = () =>
      active === controller && !controller.signal.aborted && !disposed;
    update({ busy: true, message: null });
    try {
      await action(controller.signal, current);
    } catch (error) {
      if (!current()) return;
      if (
        handleMissingSession &&
        error instanceof RepliesHttpError &&
        error.status === 401
      ) {
        const available = adapters.account().available;
        update({
          boxes: [],
          selectedId: null,
          replies: null,
          emptySession: !available,
          requiresSignIn: available,
        });
      } else {
        update({
          message: error instanceof RepliesHttpError ? error.message : fallback,
        });
      }
    } finally {
      if (active === controller) {
        active = null;
        update({ busy: false });
      }
    }
  };

  const loadBoxes = () =>
    perform(
      "Couldn’t load replies. Try again.",
      async (signal, current) => {
        const account = await adapters.refreshAccount();
        if (!current()) return;
        if (
          account.available &&
          !account.userId &&
          !(await adapters.requireAccount())
        ) {
          if (current()) update({ requiresSignIn: true });
          return;
        }
        if (!current()) return;
        const boxes = await adapters.client.listBoxes(signal);
        if (!current()) return;
        update({
          boxes,
          emptySession: false,
          requiresSignIn: false,
          selectedId:
            state.selectedId && boxes.some((box) => box.id === state.selectedId)
              ? state.selectedId
              : null,
        });
      },
      true,
    );

  const openBox = (box: ReplyBox) => {
    if (disposed) return Promise.resolve();
    update({ selectedId: box.id, replies: null });
    return perform(
      "Couldn’t load this box. Try again.",
      async (signal, current) => {
        const replies = await adapters.client.listReplies(box.id, signal);
        if (current()) update({ replies });
      },
    );
  };

  const removeBox = (box: ReplyBox) =>
    perform("Couldn’t delete this box. Try again.", async (signal, current) => {
      await adapters.client.deleteBox(box.id, signal);
      if (current())
        update({
          selectedId: null,
          replies: null,
          boxes: state.boxes.filter((item) => item.id !== box.id),
        });
    });

  const accountChanged = (nextId: string | null) => {
    const previous = accountId;
    accountId = nextId;
    // Initial sign-in belongs to loadBoxes. A previous owner's data never survives an account change.
    if (!previous || previous === nextId) return;
    cancel();
    update({ ...emptyReplyInbox(), requiresSignIn: nextId === null });
  };

  return {
    loadBoxes,
    openBox,
    removeBox,
    accountChanged,
    back: () => {
      cancel();
      update({ selectedId: null, replies: null, busy: false });
    },
    dispose: () => {
      disposed = true;
      cancel();
    },
  };
}
