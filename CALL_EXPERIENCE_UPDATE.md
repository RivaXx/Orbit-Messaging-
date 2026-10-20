# Voice call and notification update

Voice calls now have a connection-quality badge based on WebRTC RTT, interval packet loss and jitter; local listening volume and incoming-audio mute; optional screen wake lock; and microphone noise reduction. Device selectors and ringtone controls sit in an Audio & call settings disclosure. Unsupported device controls are disabled. Escape minimizes the call, Tab stays in its panel, and M toggles the microphone while the panel is open.

Hang-up releases local media immediately. An account-scoped end-of-call queue retries server updates with a six-second request timeout. Connecting calls time out after 30 seconds; disconnected calls retain the existing 20-second grace period. Recovery checks the active call after realtime reconnects. Calls answered on another device dismiss local ringing without ending the other device's call. Audio-device replacement failures release the new stream and preserve the existing stream.

Call Web Push now uses the same call tag as the foreground alert, includes a View call action and rejects pushes older than 45 seconds. Call notification links validate membership and current state; they do not automatically answer. Message alerts respect hidden previews inside the app, silence message chimes during calls, limit chime bursts, and avoid showing a system alert alongside the foreground banner. The worker respects active-client preview/sound preferences and suppresses an already displayed tag. Closed-app delivery still depends on the existing push backend, subscription, browser support and OS permission.

No database or Edge Function migration is required. Screen wake locks, output-device selection and noise constraints depend on browser/device support. No TURN relay has been provisioned; restrictive networks can still prevent a peer-to-peer connection.

Validation: 92 Node regression tests; mobile light/dark UI review with synthetic local call data. No calls were placed to real users. Physical two-device audio and OS background delivery require a device test.
