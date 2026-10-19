# Message controls and readable chats

Release: message-comfort-20261019-r2

- Delete for everyone uses a sender-only server RPC and reports success after confirmation. Deleted rows keep a placeholder and cannot be edited back into content. The 10-minute edit limit does not block deletion.
- Select messages from the chat menu or a message action. Tap or use Enter/Space to select up to 100. Delete for me is saved on the current device; delete for everyone requires your delivered messages. Failed selections remain available to retry.
- Current location shares contain one GPS fix, expire on screen after five minutes, and have their coordinates scrubbed by a server job within the next minute. There is no continuous tracking. New location quotes omit coordinates.
- Your own profile shows Joined Orbit from your account creation date.
- Bubble appearance in the chat menu saves balanced glass, blue glass, green glass or high contrast per conversation on this device. Text, quotes, links and timestamps use theme-aware colors and long text wraps inside the bubble.

## Backend
Apply MESSAGE_CONTROLS.sql after the existing messaging migrations. It is idempotent and adds deleted_at, expires_at, sender-only orbit_delete_messages(uuid[]), immutable deletion handling and the orbit-expire-locations Cron job. Production attachments are text[], so clearing them uses ARRAY[]::text[]. Applying the migration does not purge existing messages.

## Validation
Run node --test tests/*.test.cjs. The SQL regression in tests/message-controls-regression.sql creates synthetic self-chat messages and rolls back the whole transaction, covering ownership, old text/media, retries, anti-resurrection and server location expiry. Mobile browser checks cover wrapping, both themes, appearance controls and selection.
