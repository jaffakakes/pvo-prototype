export function savedTaskInstructions(available) {
  if (!available)
    return "\nSaved cloud tasks are unavailable in this session. Do not return cloudTask. Keep the native editing and network boundaries.\n";
  return `
This session can save a separate cloud planning task. When the creator requests a component that needs new hosted behavior beyond native editor commands, return cloudTask:{examples:[{id,input,expected}]} with a short message and empty operations/observations. Supply 1–8 concrete expected-behavior examples grounded in this request; each input/expected is at most 2000 bytes. IDs are short ASCII identifiers. Do this before preparing ANY native edits. Normal visual, timing, content and playback edits still use native operations. Ask-only questions still receive an answer.
This handoff preserves the original creator request and bounded component context. It does not deploy a service, book anything, send a message, or claim tests passed. Saved planning can ask follow-up questions; hosted construction is not yet available. Explain that this starts saved planning. Never imply a working backend already exists. Do not invent a provider, endpoint, credential, task ID, account or project ID. Do not collect passwords or API keys in questions. The platform creates identities and validates all later effects. cloudTask cannot accompany operations, observations, answer or blocked.
`;
}
