# Orbit chat encryption and trust model

Release: `e2ee-20261025-r1`. Reviewed: 25 October 2026.

## User setup and recovery

Open **Chat security** in the profile or chat menu. Each account creates an encryption identity locally and chooses a separate recovery passphrase of 20–256 characters. Prefer several randomly selected words; do not reuse the login password. Every member of a conversation must finish setup before new messages can send.

The client encrypts its private-key backup before uploading it. Signing into another device and entering the recovery passphrase restores the same account identity and access to its encrypted history. Orbit cannot recover that history if the passphrase and unlocked keys are lost. There is deliberately no administrator decryption key or password-reset bypass.

Private keys remain in a module worker for the unlocked tab. Closing/reloading the tab, signing out or choosing Lock removes that worker. A new tab must unlock with the recovery passphrase. The release does not silently retain plaintext keys in localStorage/IndexedDB or automatically unlock from the login password. Browser memory is not a hardware-backed keystore and secure forensic erasure is not guaranteed.

## Cryptographic format

- Unmodified, locally vendored OpenPGP.js **6.3.2**, with npm archive SHA-512 integrity verified. License and provenance are in `assets/vendor/OPENPGP.md` and `openpgp-LICENSE.txt`.
- RFC 9580 version-6 Ed25519 signing and X25519 encryption keys. The maintained library supplies fresh session keys and authenticated AES-256-GCM encryption; Orbit does not implement its own cipher or key agreement.
- Every message is signed and encrypted for the sender and all current conversation members. The authenticated content binds the message UUID, room, sender account UUID and revision. Decryption requires a verified sender signature before rendering.
- Attachments are signed/encrypted before storage upload. Original names, MIME types, quality, captions and file metadata are inside the encrypted parent. That parent authenticates each encrypted file's SHA-256 digest and storage reference. Storage sees generic binary objects. A batch prepared for a different membership/key set is rejected and must be attached again.
- Private-key backups use PBKDF2-HMAC-SHA-256 with 600,000 iterations and a random 16-byte salt, then AES-256-GCM with a random 12-byte IV. Additional authenticated data binds the account UUID and identity fingerprint. Backup parameters are bounded and validated on recovery.
- Reactions and poll votes use separately signed/encrypted per-actor state with checked revisions. They cannot overwrite the author's message. Initial author-supplied vote totals are ignored.
- New scheduled messages contain ciphertext before the server queues them. Dispatch rechecks membership; changed or unavailable conversations fail rather than downgrade. Pre-encryption schedules require review/rescheduling.

These are static account-recipient keys, not Signal's Double Ratchet. **There is no forward secrecy or post-compromise recovery.** Theft of an account's private encryption key can expose ciphertext addressed to that account, including historical ciphertext. Merely signing out another device does not revoke a copied encryption key. Identity rotation/device-specific revocation are not implemented in this release. Independent review and a reviewed ratcheting protocol remain priorities.

## Identity verification

The directory stores public keys only. Registration is immutable through browser credentials; recovery restores the existing key instead of replacing it. Clients pin contact fingerprints and block a later substitution. Chat security displays your fingerprint and the current direct contact's fingerprint for comparison through another trusted channel.

First contact uses trust on first use. A directory service compromised before the first pin could substitute a key. Compare the full fingerprints before sharing sensitive information. A pinned key is not automatically a verified human identity, and a display name alone is not proof of identity. Group members must verify identities individually; groups support up to 100 encryption recipients.

## What stays encrypted and what remains visible

New text, media, captions, quotes, contacts, locations, polls, reactions/votes and scheduled bodies cross the backend as ciphertext. Local pending message data, queued media and new drafts are also encrypted before durable browser storage. Persisted chat snapshots retain original ciphertext, and saved recent-chat previews are generic. Plaintext and decrypted blob URLs are held in the unlocked tab for display. Large attachments are limited to 49 MiB each; opening a batch is bounded to protect device memory.

The server still sees account IDs, public keys, room membership, sender/recipient IDs, revisions, timestamps, approximate sizes, storage paths, delivery/read receipts and whether a message has expiring or view-once media. Push message bodies remain generic. Public avatars and profile/directory information remain public or authorized directory data as documented by the app. Notes, calendar data and WebRTC signaling are not encrypted by this chat format. WebRTC provides encrypted media transport, without independent caller fingerprint verification.

Old messages and media are **not retroactively encrypted**. They remain labeled Legacy and can be read by authorized backend administrators. Existing legacy drafts/media queues migrate when saved or sent through the new pipeline; historical browser/profile backups may retain old readable data. Applying the migration does not purge chats, accounts or profile pictures.

Current-location messages have a signed five-minute display expiry. Server cleanup removes their stored ciphertext/coordinates on its scheduled pass. This is retention behavior, not cryptographic destruction: a recipient can copy coordinates, ciphertext, files or screenshots. View-once access likewise cannot prevent screenshots or a modified recipient client. Previously issued signed URLs remain usable until expiry; for new encrypted media they expose ciphertext.

## Trust boundaries and limits

HTTPS, authentication, membership RLS, private storage and server ownership checks remain necessary. They reduce unauthorized access and abuse even though new message bodies are encrypted.

The deployed JavaScript, browser, device and unlocked session must be trusted. Malicious application updates, XSS, extensions, operating-system compromise, screen recording or an authorized recipient can expose plaintext. The worker limits accidental key exposure and avoids expensive crypto on the UI thread; it does not make a compromised page safe. The current CSP still permits inline code for compatibility. The server can withhold/delete data and alter unencrypted metadata. No independent penetration test or cryptographic certification is claimed.

Primary references: [OpenPGP.js documentation](https://docs.openpgpjs.org/), [upstream security recommendations](https://github.com/openpgpjs/openpgpjs#security-recommendations), [RFC 9580](https://www.rfc-editor.org/rfc/rfc9580.html), [Signal specifications](https://signal.org/docs/).
