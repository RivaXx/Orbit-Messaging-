Changes made on 14 October 2026

- Fixed the accent palette across body themes, gradients, glow, and logo. The saved accent is restored quietly on reload.
- Custom blur, opacity, and glow values now survive reload, including zero. Settings radio controls reflect saved media quality, group privacy, and pod dock position when reopened.
- Raised the account menu above the weather button. Clicking the avatar opens Profile, including accounts with no uploaded avatar.
- Hold an individual navigation button for 500 ms, then drag left or right to reorder Chats, Global, and the other buttons inside the stationary pod. Order is saved on the device; ordinary swipes scroll the tabs. Alt + Left/Right reorders a focused button, and Settings includes a reset button.
- Water glass now covers UI surfaces across chats, profile, settings, cards, menus, notifications, and tools. Settings provides a master switch, water bend, blur, tint (0–100%), ambient glow, ripple speed (0 freezes motion), saturation, edge highlights, presets, and reset. Preferences update live and persist on the device. Reduced motion keeps refraction static; browsers without SVG backdrop support retain ordinary blur.
- Restricted the configured admin and blue tick to rivaldo.a.rodrigues@gmail.com.
- Removed the calculator Display button.
- Replaced the dummy cleanup toast with a server-side cleanup service. Manual cleanup clears all existing messages (text and media), including admin messages. Accounts and profile photos are preserved. Scheduled cleanup covers messages older than ten days for all accounts.

The old screenshot's cleanup was not implemented. Its switch only saved a browser preference, and its button always reported success without deleting anything. The old description about preserving all admin chats has been replaced to match the requested all-message cleanup.

Backend deployment required

1. Run SETUP_ORBIT_ADMIN_CLEANUP.sql in the project's Supabase SQL Editor. It creates the disabled-by-default settings, a durable retry queue, and service-role-only functions. Running this setup does not clear messages.
2. Deploy the function with `supabase functions deploy orbit-admin-cleanup --project-ref dhtbiggamuwoqurguhib`.
3. For daily scheduling, enable pg_cron and pg_net in Supabase. Set a long random ORBIT_CLEANUP_SECRET in Edge Function secrets. Store the same secret in Vault as orbit_cleanup_secret, and the project's public anon key as orbit_cleanup_anon_key. Run the commented cron.schedule example at the end of the SQL file. It runs daily at 00:00 UTC (05:30 IST).
4. Sign in with the primary admin and enable Scheduled cleanup. The switch refuses to enable without an active orbit-message-cleanup cron job. Manual cleanup works without cron and requires confirmation in the app.

The service validates the caller through Supabase Auth and compares the authenticated email. Neither profile data nor editable presence email authorizes cleanup. Scheduled invocations require the private server secret. Database cleanup functions and queues are unavailable to anon and authenticated database roles. A read-only cleanup timestamp lets signed-in clients discard stale cached messages when they reconnect, open a chat, or return to the app. Offline devices cannot receive deletion updates until they reconnect.

Only referenced objects in chat-assets and orbit-view-once are candidates for removal. Profile, presence, Auth, and room avatar URLs and attachments referenced by remaining messages are excluded. Whole buckets are never emptied. Sender ownership checks reject arbitrary or forged storage paths. Legacy objects with unknown ownership are retained. Inline/base64 media is removed with its message record. Storage failures remain queued for retry; the app reports pending work instead of claiming success. A large cleanup processes up to 200 queued message batches per invocation; run again to finish, or let subsequent enabled cron runs retry.

Verification

Run `node --test tests/settings-cleanup.test.cjs` with Node 24 or later. The tests cover accent restoration, custom glass settings, pod positioning, admin authorization, required confirmation, schedule secrets and setup, photo protection, and storage retries. Browser visual verification and live Supabase integration are still required after deployment. No production cleanup was executed.
