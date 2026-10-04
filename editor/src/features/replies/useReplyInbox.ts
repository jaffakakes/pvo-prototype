import { useEffect, useRef, useState } from "react";
import {
  createRepliesClient,
  type ReplyBox,
} from "../../infrastructure/replies/client";
import type { AccountSession } from "../../infrastructure/auth/client";
import {
  refreshAccountSession,
  requireAccount,
  useAuthGate,
} from "../../state/auth/authGateStore";
import {
  createReplyInboxWorkflow,
  emptyReplyInbox,
} from "./replyInboxWorkflow";

function accountState(
  account: Pick<AccountSession, "available" | "clerkAvailable" | "user">,
) {
  return {
    available: account.available || account.clerkAvailable,
    userId: account.user?.id ?? null,
  };
}

/** Bind the inbox request owner to the mounted view and current account. */
export function useReplyInbox() {
  const [state, setState] = useState(emptyReplyInbox);
  const accountUserId = useAuthGate((account) => account.user?.id ?? null);
  const workflow = useRef<ReturnType<typeof createReplyInboxWorkflow> | null>(
    null,
  );

  useEffect(() => {
    const current = createReplyInboxWorkflow({
      client: createRepliesClient(),
      account: () => accountState(useAuthGate.getState()),
      refreshAccount: async () => accountState(await refreshAccountSession()),
      requireAccount: () => requireAccount("replies"),
      changed: setState,
    });
    workflow.current = current;
    void current.loadBoxes();
    return () => {
      current.dispose();
      if (workflow.current === current) workflow.current = null;
    };
  }, []);

  useEffect(() => {
    workflow.current?.accountChanged(accountUserId);
  }, [accountUserId]);

  return {
    ...state,
    loadBoxes: () => workflow.current?.loadBoxes(),
    openBox: (box: ReplyBox) => workflow.current?.openBox(box),
    removeBox: (box: ReplyBox) => workflow.current?.removeBox(box),
    back: () => workflow.current?.back(),
  };
}
