# Account profiles

`GET /api/account/profile` returns `{ id, name, email, photo }` for the current Restyle session. `email` is nullable; where available it comes from a verified provider session mapped to the same Restyle account and is never stored in the profile. `photo` is a bounded JPEG data URL or null.

`PUT /api/account/profile` accepts `{ id, name, photo }`. The cookie owns the storage key; the body ID guards against saving after an account switch. Mutations require the exact application Origin. Names are trimmed and limited to 120 characters. Photos are decoded and cropped to 256px in the browser; the server permits only JPEG data URLs under 64 KiB. Requests are bounded to 92,000 bytes. An error never reports a successful save.

Cloudflare keeps one private JSON object per account under `MEDIA/account-profiles/{id}.json`. No public image URL is created. The loopback beta uses atomic 0600 files under its private `account-profiles/` data directory, keyed by a hash of the authenticated account ID. Account-data deletion must include that profile object/file. Project checkpoints remain in the browser; signing in or editing a profile does not enable project cloud saving.

The account menu shares header positioning and dismissal with Project settings. The profile avatar opens photo selection; Edit profile also provides photo and name controls. Appearance stays in Project settings. Discord intentionally has no destination until an invite is supplied. Help opens support@getrestyle.app. Sign out uses the same Restyle/provider cleanup command as the account dialog and leaves the project open.
