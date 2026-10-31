# Orbit chat data operations

## Admin cleanup

Only the Supabase-authenticated email `rivaldo.a.rodrigues@gmail.com` may start or resume cleanup. The second photo-allowance account is not a cleanup administrator. Client profile fields never grant this permission.

Deploy `supabase/migrations/20261027_cleanup_jobs.sql` after the existing cleanup and encryption migrations, then deploy `orbit-admin-cleanup`. Applying the migration does **not** clear messages. Settings → Storage operations asks for explicit confirmation before starting the destructive job. Download required backups first.

One fixed server cutoff defines a job. It clears older chat message rows, associated encrypted events/view-once receipts through foreign-key cascades, pending message notifications and scheduled messages. It inventories old chat objects in `chat-assets`, `voice-notes`, `files`, `uploads` and `orbit-view-once`, including orphaned uploads. It does not clear arbitrary buckets, accounts, names, contacts, encryption identities/recovery keys, notes or calendar data. Dedicated avatar buckets, profile/avatar directories, profile URLs and media referenced by surviving messages are preserved.

Storage object bytes are removed with Supabase Storage API. Deleting SQL storage metadata is deliberately forbidden. A durable queue, short batches and leases survive failures and browser closure. A retry resumes the same cutoff rather than deleting newly arrived chats. Completion appears only when no eligible object remains pending. A file changed or made into a profile picture before its batch is protected. Upload paths are immutable in Orbit; administrators should not concurrently overwrite an old object path while cleanup runs.

A server-only attachment-reference index is backfilled once and maintained by message triggers. It prevents a full chat-history scan for each storage object, and is automatically cleared for deleted messages. Browser roles cannot read or modify it.

Scheduled cleanup uses the same queue with the existing ten-day retention rule. Keep the existing authenticated cron/secret configuration. A large job may need further scheduled invocations or the admin's Resume button. New messages and uploads after a job's cutoff are preserved. Devices check the cleanup watermark when opening history, reconnecting, returning to the app and periodically while visible; stale cached content is filtered. Offline devices learn about a purge on reconnect. Downloaded archives and recipient screenshots cannot be remotely erased.

## Personal encrypted archives

Settings → Chat backup & restore exports accessible conversations, optionally including media. Choose a separate backup passphrase of 20–256 characters. The `.orbitbackup` file uses PBKDF2-HMAC-SHA-256 (600,000 iterations), random salt, AES-256-GCM authenticated records, sequence binding, authenticated header and a required encrypted completion footer. No login password, session token or raw encryption key is included. Both legacy content and new decrypted content are encrypted in this archive. Unlock Chat security before exporting new encrypted messages.

Limits protect mobile memory: 10,000 messages, 49 MB per attachment, 110 MB total media, and 160 MB encrypted archive. Export individual conversations or turn off media for larger histories. A failed attachment download fails the export rather than claiming a complete backup. View-once media, expired location coordinates and content removed by server deletion are excluded. Export uses a timestamp/cursor snapshot; concurrent edits/deletions may affect which currently accessible rows appear.

Open a backup with its passphrase while signed into the same account. The entire archive must authenticate before it is shown. Restored history is an in-memory, read-only viewer with search, conversation selection and attachment downloads. It is **not uploaded back to Supabase** and never restores globally purged messages. Close the viewer or lock/sign out to clear its displayed content and blob URLs. Keep archives and passphrases securely: losing them is not recoverable by Orbit. A compromised browser/device can read content while unlocked.

## Receive gallery and OS shares

Install the updated Orbit PWA on a browser/OS supporting Web Share Target (notably Chrome/Edge on Android and supported desktop systems). An existing installation may need to reopen/update, or reinstall if the OS has not refreshed its share registration. Website-only tabs and Safari/iOS do not provide this incoming share-target integration.

The manifest advertises a multipart POST share endpoint. The service worker encrypts a temporary local inbox in IndexedDB, redirects with an opaque share ID, and never sends shared content to an external service. Each share expires in 15 minutes, accepts up to 20 files, 49 MB each / 100 MB total, and is bound to the first signed-in account that opens it. A local non-extractable CryptoKey protects staging from casual storage inspection; it does not protect against same-origin script compromise. Expired items are pruned on inbox use; no background execution after browser shutdown is guaranteed.

Users sign in if needed, choose a conversation and see Orbit's existing attachment preview. Nothing is sent automatically. Shared text is appended to the existing composer draft. Cancel/discard and account isolation prevent accidental sends. Storage errors are shown instead of silently dropping the share. Ordinary encrypted sending, original-quality allowance and delivery behavior still apply.

## Verification

Run `node --test tests/*.test.cjs tests/*.test.mjs`. The cleanup regression uses only synthetic rows/storage metadata inside rolled-back transactions and a 1970 cutoff; it never calls the Storage deletion API. Do not run a live global purge as a deployment test. Node tests cover authorization, pagination, storage failures/resume, encrypted archives/tampering and share POST handling. Browser checks cover real IndexedDB encryption, export/restore and both themes. Actual appearance in Android's OS share sheet additionally requires testing an installed PWA on an Android device.

## Media reliability release — 1 November 2026

`media-share-20261101-r1` serializes local file staging across albums and allows longer file-crypto operations. The composer accepts up to 20 files, 49 MiB each and 100 MiB total, with saving/encrypting/upload progress shown in the message. Original quality bypasses compression; existing account allowances still apply.

The original/prepared file remains in its encrypted local queue slot. A separate IndexedDB record commits the upload ciphertext and signed, encrypted retry metadata in one transaction. A stale outbox record can recover that checkpoint after reload. New object names include the ciphertext digest, so regenerating ciphertext after a lost local checkpoint cannot accidentally reuse a different object's bytes. Legacy pending queues keep their earlier paths. Message UUIDs stay fixed and insertion still occurs only after every attachment upload succeeds. A device-storage failure falls back to this tab and asks the user to keep it open. Confirmed delivery removes both original and checkpoint records.

The manifest includes square 192px and 512px PNG icons alongside the existing SVG. Android gallery integration still requires a supporting installed/updated PWA, and OS share registration may lag an app update. Finish pending sends before reinstalling. Physical Android share-sheet behavior has not been verified.

This release retains mandatory encryption. Optional ordinary chat and conversation privacy consent require a separate authenticated server/client protocol change and are not included. Recovery passphrases, encryption identities, existing encrypted history, backup formats, storage policies and admin cleanup are unchanged.

## Android albums and Gallery fallback — 1 November 2026

`albums-20261101-r2` copies and validates every selected Gallery file into an app-owned File before clearing the picker or accepting the album. Android/cloud-provider handles are no longer held as the source for delayed encryption. If any provider file cannot be read, the selection fails visibly before an album is accepted; no subset is sent. Limits remain 20 files / 49 MiB each / 100 MiB aggregate. Account and chat changes invalidate the pending selection.

SD/HD resizing now uses binary canvas blobs and releases each decoder/canvas after encoding. Small thumbnail blobs keep a large album's preview strip and pending bubble from decoding every original at full resolution. Original upload bytes remain separate. Reading/preparing progress is visible, errors wrap on narrow screens, and failed media retain a readable explanation plus retry/reselect controls. Existing failed albums whose source bytes were never successfully copied by an older build may require selecting those originals again; missing bytes cannot be reconstructed from stale provider handles.

Chats → Send photos is an additional entry into the same recipient picker and attachment preview used for incoming OS shares. It works without Android share-sheet registration and never auto-sends. Cancellation and account switches prevent delayed file reads from opening a new recipient picker. Settings → Gallery sharing help explains the distinction between web-code updates and Chrome's installed WebAPK registration. The manifest's explicit id matches its earlier inferred start-URL identity (`/index.html`), retaining the same installed app identity.

Regression coverage includes an 18-file provider whose handles become unreadable when the picker is reset, failed-file selection, Gallery fallback destination/preview, cancellation, account changes and the existing retry/security suites. Browser integration exercised the actual selection, binary SD/HD encoding, real encryption worker, IndexedDB, upload routine and message-insert boundary using synthetic accounts and in-memory backend/storage adapters: 18 SD + 18 HD photos authenticated and decoded by the recipient, one message per album, including a lost-success upload response and retry. No production chat content was used or sent. Physical Android Gallery/Chrome behavior remains unverified; a website cannot force Android to register or expose a WebAPK share target.

## Production database blocker: oversized album index

The phone's exact server rejection is PostgreSQL `54000`: `index row size ... exceeds btree version 4 maximum 2704 for index idx_messages_feed_covering`. Frontend simulations did not include this production-only legacy covering index. The media uploads can succeed while the final album row fails. Do not lower security or split messages to hide this database failure.

Apply `supabase/migrations/20261101_album_feed_index.sql` in project `dhtbiggamuwoqurguhib` before publishing `album-repair-20261101-r3`. It adds a feed cursor index containing only room, created_at and id, verifies its shape, then removes only the named non-unique/non-constraint covering index. It refuses unexpected ownership or constraint indexes, uses bounded lock/statement timeouts, and runs atomically. No chat rows, storage objects, accounts, encryption keys, grants or RLS policies are modified. Success returns `album_index_repair_complete`; production verification is still required. Retry a previously uploaded failed album using its existing message UUID/checkpoints after the repair.

The separate PostgreSQL regression uses PGlite 0.5.13, reproduces the actual B-tree error with non-compressible message content, then verifies full payload insertion, migration idempotence, unchanged existing history/RLS/policy, and refusal to remove a unique index. CI installs that engine in an isolated temporary directory and runs `node --test tests/album-index.pg.cjs` in addition to the ordinary suite.

The prepared client release moves encrypted outbox metadata to IndexedDB with a legacy/localStorage fallback, retains pending sends during migration, and treats oversized-index errors as a repair requirement. SD encoding can target smaller byte sizes without altering HD/original selections. The main Gallery entry uses a native file input rather than depending solely on a scripted hidden-input click. Android's external Gallery share registration remains a separate installed WebAPK/browser concern and has not been physically verified.
