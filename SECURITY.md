# Security policy

Only the latest production release is maintained. Apply both application updates and the corresponding Supabase migrations; publishing JavaScript alone does not update database protections.

## Encryption disclosure

Orbit does **not currently provide end-to-end encrypted messaging**. Messages are sent over HTTPS and access is controlled by Supabase authentication and database policies. The service and authorized database administrators can read stored messages. Private media access and HTTPS are not E2EE. See [CHAT_ENCRYPTION.md](CHAT_ENCRYPTION.md).

## Report a vulnerability

Use GitHub's private vulnerability reporting feature, if enabled, from this repository's Security tab. If unavailable, contact the repository owner privately before sharing details. Do not publish session tokens, private message contents, media links, credentials or reproduction data in public issues. Maintainers should enable private reporting in repository settings.

Include the affected release, expected and observed behavior, impact, and a minimal reproduction using your own accounts. Do not access other people's conversations, brute-force accounts, send unsolicited calls/push notifications, or run destructive production tests.

## Rules for contributors

- Never commit service-role keys, signing keys, SMTP credentials, access tokens or real chat exports. The browser's publishable/anon key is intentionally public; it must never bypass authorization.
- Enforce ownership and room membership on the server. Hidden controls and browser email comparisons are not authorization.
- Treat attachments, profile fields, reactions, quotes, broadcasts and cached data as untrusted. HTML escaping alone is insufficient inside JavaScript event-handler strings.
- Use narrow RPCs for shared state changes such as votes and reactions. Peer broadcasts are hints; the database confirms content.
- New definer functions need an explicit `search_path`, authenticated actor checks where applicable, and explicit execution grants. Review permissive and restrictive policies together.
- Chat buckets must remain private. Do not run legacy repair scripts that recreate public buckets without reapplying the current security migrations.
- Keep tests synthetic and roll back database tests. Never purge chats or profile pictures as part of a security check.

Read [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for findings and [SECURITY_OPERATIONS.md](SECURITY_OPERATIONS.md) for release and incident procedures.
