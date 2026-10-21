# Dev handoff — 21 October 2026

This brings the current editor work together on `dev` so it can be continued on another computer. It is not a production release.

## What was brought together

- Cleaner camera, timeline, scene tree, project settings and account menu.
- Better light/dark styling, consistent rounded controls and shared animations, including Reduce motion.
- Component selection tools, the Design/Logic page, and shared full-screen cover/timing pickers.
- Roomier component previews, with the unwanted “In this video” list removed.
- The refreshed AI orb, floating input, useful suggestions, attachments, progress focus, dismissal and cancellation.
- Supabase Google/email sign-in and restoration of an accepted login after beta updates.
- The local beta connection to the hosted AI service, plus the project-saving recovery fixes.

## Continue on desktop

Use the repository’s `dev` branch, install dependencies with `npm ci`, then run `npm run dev`. The build needs Rust, the `wasm32-unknown-unknown` target and wasm-pack; see the [setup commands](../../scripts/README.md).

Configure local sign-in using the private Supabase settings described in [account setup](cloudflare-publishing.md#local-account-adapter). Credentials and machine-specific configuration are not committed.

Video drafts and media saved in the Mac browser do not transfer through Git. Export any project you need on the other computer separately. You will also sign in on that computer.

AI inference runs on the hosted backend, not on the desktop. New attachment handling is included in this source, but using it through the local proxy requires the hosted backend to support the same contract. This handoff does not deploy backend changes. See the [local assistant connection](../../scripts/README.md#local-assistant-connection).

Other open cloud-agent pull requests remain separate from this editor/login handoff.
