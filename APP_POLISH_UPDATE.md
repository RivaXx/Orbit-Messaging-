Orbit app update · October 18, 2026

- Light mode uses readable local surfaces and dark ink in chat input, message bubbles, Settings, menus and forwarding.
- Typed composer text becomes the photo album caption. Cancel and queue failures retain the draft; one send queues the complete batch. The editor no longer overrides the album sender. Photo grids open a gallery with previous/next, thumbnails and swipe navigation.
- Forward picker clicks no longer dismiss the modal. Successful destinations are removed from retries; direct contacts resolve to their canonical room. The forwarded marker lives in existing `reply_to` JSON metadata because production has no `messages.is_forwarded` column. No schema migration is needed.
- Chats has Select and Select all controls. Delete for me removes selected conversations and their aliases from this device's list/cache, preserving other users' copies. Open a person from Global to show their chat again.
- Global prioritizes fresh online presence, then most recent last seen; presence updates re-sort the visible directory.
- The loading screen includes the supplied SVG logo and a reduced-motion-aware shimmer. Valid saved sessions paint cached UI immediately; session repairs run in the background. Deferred scripts download concurrently in execution order. Versioned shell assets use the offline cache; cached navigation has a bounded network wait.
- Optional Google sign-in beta uses Supabase OAuth with PKCE. It checks provider availability, exchanges the returned code, removes callback parameters and keeps email/password login available. Google is enabled in this project's public auth settings; the provider redirect/account flow still needs a user sign-in to verify end to end.
- Weather waits for a fresh high-accuracy fix, keeps the best reported fix, and displays coordinates, accuracy and a map link alongside a fuller place name. Browser/device accuracy and forecast-grid resolution still limit precision; Orbit cannot guarantee an exact street-level GPS fix or weather measurement.

Validation: Node regression suite; local browser checks with synthetic data for light chat and Settings, four-photo captions/grids, selection, forwarding and startup branding. The local preview fixture is excluded from Git and must not be deployed.

Google setup reference: https://supabase.com/docs/guides/auth/social-login/auth-google
