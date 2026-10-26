# Security operations and verification

## Release order

For `e2ee-20261025-r1`, first retain/verify the hardening prerequisites below, then:

1. Run `20261025_e2ee.sql` and `tests/encryption-authorization-regression.sql` together in a **single rolled-back staging transaction**. Remove their inner transaction boundaries when composing that outer transaction. Do not accept a partial or failed run.
2. Apply `supabase/migrations/20261025_e2ee.sql` to production after review. It adds the immutable public-key directory, owner-only encrypted backups, encrypted-message headers and checked event/edit/schedule RPCs. It preserves existing data. Old browser clients are deliberately unable to send plaintext after this cutover.
3. Publish the matching frontend immediately, including the module worker, core module, unmodified vendored OpenPGP bundle, license, `encryption.css`, updated release-tagged assets and service worker. Confirm marker `e2ee-20261025-r1` and exact production asset contents. Reload older clients.
4. Run both authorization regression files as complete transactions. Verify key/backup/event RLS and grants, immutable identities, receipt updates, encrypted schedule dispatch and deletion of old encrypted messages. Synthetic accounts/events are rolled back; no real user's encryption identity is created or replaced by these checks.
5. Test new-key setup, correct/wrong recovery passphrases, text and media between disposable accounts, altered ciphertext, key changes, encrypted drafts/queues, groups, captions, forwarded copies, votes/reactions, signed location expiry and refresh. Verify API/storage records contain ciphertext and generic file references, never private-key armor, passphrases, captions or original filenames.

Users must set up Chat security and retain their separate recovery passphrase. Do not register identities or choose real recovery credentials for users. Legacy messages/media remain readable legacy data; do not silently relabel them encrypted. Plaintext schedules queued before cutover must be reviewed/rescheduled. A frontend rollback alone does not bypass the encryption guard; keep sending blocked while repairing an incompatible deployment rather than disabling protection.

### Hardening prerequisites

1. Review SECURITY_AUDIT.md and CHAT_ENCRYPTION.md. Back up the database configuration through your normal trusted process. Never commit a database dump or secrets.
2. Publish the application changes, `vercel.json` and updated service worker. Confirm the production release marker `security-audit-20261024-r1` and updated file contents before changing bucket visibility.
3. For an existing Orbit installation that lacks the older production security guards, review/apply `supabase/migrations/20261024_security_baseline.sql` after the existing schema is installed. It records previously deployed helpers, policies and triggers; it is not a complete empty-project schema. Existing audited production does not need the baseline reapplied.
4. Apply `supabase/migrations/20261024_security_hardening.sql`. It tightens direct writes, switches chat buckets to private, updates media authorization and removes unnecessary browser privileges. It does not purge messages, accounts, profile pictures or files.
5. Redeploy `supabase/functions/orbit-message-push/index.ts` with the endpoint check. Preserve its existing secret configuration and JWT gateway setting. Do not copy service-role credentials into the browser or GitHub.
6. Run the SQL regressions below and verify deployed bucket flags, policies and function grants. Reload older clients so video/audio access uses the current signed-media handling. Older clients may display inaccessible media until refreshed.

Do not rerun legacy `FIX_ORBIT_*` / setup SQL indiscriminately: some older scripts intentionally create public buckets. Reapply the latest hardening after any legacy repair, and verify it before declaring the repair complete.

## Automated checks

From the repository root:

```sh
node --test tests/*.test.cjs tests/*.test.mjs
```

Run `tests/security-authorization-regression.sql` in the project's SQL editor. It selects two existing account IDs only as actors, creates synthetic messages and notification events, uses authenticated/anonymous roles, then rolls everything back. It reads no real message contents. Keep the entire transaction together. Any error means the test did not pass; do not publish a success based only on the last SELECT.

For staging a migration without committing it, wrap the migration body and regression checks in one outer transaction, remove their inner BEGIN/COMMIT, and end with ROLLBACK. Existing message-control, receipt, typing and note-ownership SQL regressions should also remain passing.

Manual browser checks should use disposable accounts: direct/group messages, attachment and album previews/downloads, audio/video playback, account switching, receipt updates, reactions/polls and expired media links. Verify malicious names/reactions show literal text and cannot create elements or execute handlers. Do not send test pushes or calls to real users.

`tests/encryption-core.test.mjs` runs real-library cryptographic cases. `tests/encryption-boundary.test.cjs` exercises the application's actual encryption boundary, setup/recovery logic and storage format using synthetic SDK/worker transport. Also verify the real module worker in a supported browser; Node transport mocks alone do not prove browser compatibility. The SQL encryption tests use synthetic format-valid envelopes for authorization and do not substitute for signature tests.

## Configuration checks

- Chat-media buckets `chat-assets`, `voice-notes`, `files`, `uploads` must be private. `orbit-view-once` remains private. Public avatar visibility is intentional.
- Anonymous clients must not read messages, room memberships, notes, subscriptions or cleanup state.
- Non-members must not read a room or obtain its media URL. A message recipient must not alter its sender, text, attachment references or other users' receipts.
- Restrictive boundaries must remain in place when legacy permissive policies exist. Inspect effective privileges, not just whether RLS is enabled.
- Definer RPCs must bind the actor to `auth.uid()` or be service-only; pin their search path and review all grants.
- Confirm `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and CSP on production responses. The current CSP is a compatibility baseline, not a strict policy.

## Credentials and incident handling

Use MFA on the GitHub, Supabase and hosting accounts where supported. Keep production secrets in provider secret stores. Rotate a service key, webhook secret, SMTP credential or VAPID private key if exposure is suspected; removing a value from a new commit does not invalidate historical copies. Determine which sessions and push subscriptions also need revocation.

For a suspected leak: contain the affected endpoint, preserve sanitized timestamps and request IDs, restrict further access, rotate affected credentials, identify the affected accounts/data and follow applicable notification duties. Do not publish personal chat data as evidence. Retest fixes with synthetic accounts before restoring normal operation.

## Known limits

Short-lived signed URLs do not prevent recipients saving files. Private storage alone does not hide legacy data from service-role holders. New chat content is encrypted, with the static-key, first-contact, trusted-browser and recovery limits in CHAT_ENCRYPTION.md. Legacy caches and browser-profile backups may retain readable old data. Rate limits, SMTP/login recovery delivery, strict CSP, dependency modernization, key rotation/device revocation and a reviewed forward-secret messaging protocol require further work. Recheck this document after schema, authentication, storage, dependency or hosting changes.
