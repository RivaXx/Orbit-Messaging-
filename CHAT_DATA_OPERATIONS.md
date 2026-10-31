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
