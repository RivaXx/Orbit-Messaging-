# Security policy

Only the latest production release is maintained. Apply both application updates and the corresponding Supabase migrations; publishing JavaScript alone does not update database protections.

## Encryption disclosure

The `e2ee-20261025-r1` release encrypts and signs new chat content on the sending device. Recipients decrypt it locally. This includes attachments, captions, quotes, contacts, polls, reaction/vote state and newly scheduled messages. Each participant must set up Chat security first. Missing keys or encryption failures block sending; there is no plaintext fallback.

Existing history remains legacy server-readable data. Notes, public profiles and call signaling are outside this chat-encryption format. Static account keys do not provide forward secrecy, device revocation or a Signal ratchet. Orbit's integration has not received an independent cryptographic audit. See [CHAT_ENCRYPTION.md](CHAT_ENCRYPTION.md) for the exact trust model and recovery limits. No system is guaranteed unhackable.

## Report a vulnerability

Use GitHub's private vulnerability reporting feature, if enabled, from this repository's Security tab. If unavailable, contact the repository owner privately before sharing details. Do not publish session tokens, private message contents, media links, credentials or reproduction data in public issues. Maintainers should enable private reporting in repository settings.

Include the affected release, expected and observed behavior, impact, and a minimal reproduction using your own accounts. Do not access other people's conversations, brute-force accounts, send unsolicited calls/push notifications, or run destructive production tests.

## Rules for contributors

- Never commit service-role keys, signing keys, SMTP credentials, access tokens or real chat exports. The browser's publishable/anon key is intentionally public; it must never bypass authorization.
- Never send private chat keys or recovery passphrases to the backend. Use the vendored, pinned encryption library and authenticated message format. Do not introduce plaintext notification, cache, scheduling, forwarding or upload fallbacks.
- Enforce ownership and room membership on the server. Hidden controls and browser email comparisons are not authorization.
- Treat attachments, profile fields, reactions, quotes, broadcasts and cached data as untrusted. HTML escaping alone is insufficient inside JavaScript event-handler strings.
- Use narrow RPCs for shared state changes such as votes and reactions. Peer broadcasts are hints; the database confirms content.
- New definer functions need an explicit `search_path`, authenticated actor checks where applicable, and explicit execution grants. Review permissive and restrictive policies together.
- Chat buckets must remain private. Do not run legacy repair scripts that recreate public buckets without reapplying the current security migrations.
- Keep tests synthetic and roll back database tests. Never purge chats or profile pictures as part of a security check.

Read [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for findings and [SECURITY_OPERATIONS.md](SECURITY_OPERATIONS.md) for release and incident procedures.
