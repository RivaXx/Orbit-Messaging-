# Orbit chat encryption and trust model

Reviewed: 24 October 2026.

## What the current system protects

HTTPS protects traffic between the browser and the service. Supabase verifies sessions. Room-membership policies limit which signed-in users can read a conversation. Server checks protect sender identity and shared message updates. Private storage policies authorize media access; the app obtains short-lived signed URLs for permitted objects.

These controls protect against unauthorized ordinary users and unauthenticated requests. They do not hide plaintext from the server operator, a service-role key holder, a compromised server, or someone controlling an unlocked browser.

Text, attachment metadata, scheduled messages and notes are stored as readable data. There is no client-side chat key agreement, per-device identity verification, ratchet or encrypted attachment-key envelope in the reviewed messaging pipeline. The previous "E2EE Active" label was inaccurate and is removed.

WebRTC supplies encrypted media transport for calls, but Orbit has not implemented independent caller identity/fingerprint verification. This audit does not certify a native-call or Signal-equivalent security model.

## Media and local-device limits

- A signed media URL is a bearer capability. Someone receiving that URL can use it until expiry. New URLs are limited to five minutes; already issued older URLs may last longer. Deletion cannot retract downloaded copies, screenshots or previously issued capabilities immediately.
- Public profile avatars are intentional directory content. Treat them as public. Other chat-media buckets must be private.
- Browser message caches, drafts, pending uploads and remembered sessions are not a secure encrypted vault. Shared devices, malicious extensions and operating-system compromise remain risks. Do not store sensitive conversations on a shared browser profile.
- View-once controls are access restrictions, not screenshot or camera prevention.
- External images and links can disclose a visitor's IP to their host. Referrers are suppressed by this release's web headers, but that does not anonymize network traffic.

## Requirements before claiming E2EE

This is a separate engineering project, not a label or a single AES helper. Evaluate a maintained, independently reviewed messaging protocol/library and its licensing and browser support. Do not invent cryptography or keep a shared chat decryption key on the server.

1. Generate device identity keys locally; design non-exportable key storage, recovery and device revocation. Authentication passwords must not become raw encryption keys.
2. Authenticate recipient device keys using safety numbers/QR verification, key-change notices and a key-directory threat model. Address a malicious server substituting public keys.
3. Use authenticated asynchronous session establishment and a reviewed ratchet providing forward secrecy and post-compromise recovery. Define replay, duplicate, out-of-order and multi-device behavior.
4. Encrypt each attachment locally with a fresh random key and nonce. Send only ciphertext to storage; distribute its key and authenticated metadata inside the encrypted message.
5. Bind conversation, sender device, protocol version and message identity to authenticated ciphertext. Handle group membership changes, removed devices and key rotation.
6. Keep notification bodies generic. Redesign server-side scheduling, search, quote previews, moderation, backups and recovery around ciphertext rather than silently retaining plaintext copies.
7. Introduce an explicit new encrypted-message version. Preserve old history as clearly labeled legacy plaintext; never silently downgrade encrypted conversations.
8. Run published protocol vectors, multi-device/offline/restore tests and an independent cryptographic review before enabling the E2EE claim.

Acceptance evidence must show that database/storage exports and service-role access cannot decrypt new messages, altered ciphertext fails authentication, removed devices cannot decrypt future messages, and users can verify key changes. Metadata such as account IDs, room membership, timing and message sizes may remain visible even with E2EE.

Primary references: [Signal specifications](https://signal.org/docs/), [Supabase storage access model](https://supabase.com/docs/guides/storage/buckets/fundamentals), [OWASP ASVS](https://asvs.owasp.org/). This document is a design checklist, not a claim of protocol implementation or certification.
