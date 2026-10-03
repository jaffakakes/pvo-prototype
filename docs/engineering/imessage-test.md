# Mac iMessage test sender

The standalone beta page `/imessage-test.html` lets someone enter their own number, check an explicit opt-in box and submit without depending on the editor's video playback. It shows whether the Mac sender is connected and reports the send result. The authored editor form can use the same endpoint.

The editor's phone form can POST `{ "phone": "+…", "consent": true }` to `/api/imessage/test`. The button must say that pressing it sends the fixed text **“Hi, how are you?”**. The phone number needs a country code. The website waits up to twelve seconds for the Mac's result and shows a request failure when Messages rejects the send. A pending response means the Mac may still be processing the request; it is not delivery confirmation.

The Cloudflare Worker queues the number for a Mac process that polls `/api/imessage/next` over HTTPS. `npm run dev:imessage` starts that process. It uses an enabled iMessage account in the Mac's Messages app, then calls its AppleScript `send` command. Run it in a local Mac Terminal and approve the macOS Automation prompt for Messages if one appears. Restart the command after granting access. The process must keep running while testing; when it is offline, the form returns an error before storing a number. Stop it with Ctrl+C.

The Mac process authenticates with the Worker secret `IMESSAGE_BRIDGE_TOKEN`. Its local copy is `.wrangler/imessage-bridge-token` with owner-only file permissions. Neither the token nor submitted numbers belong in git, logs, or a form URL. The Worker accepts at most ten test requests per UTC day; the same number can request another test within that allowance. A queued phone number expires after one minute; the queue removes it as soon as the Mac claims it. Result records retain only a keyed digest for one day. No arbitrary message text or destination endpoint is accepted from the browser.

The response means Messages accepted the send command. It cannot confirm carrier delivery or that the recipient's device displayed the message. The sender uses iMessage accounts only; a number without iMessage may fail instead of falling back to SMS.
