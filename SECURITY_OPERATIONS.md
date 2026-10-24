# Security operations and verification

## Release order

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
node --test tests/*.test.cjs
```

Run `tests/security-authorization-regression.sql` in the project's SQL editor. It selects two existing account IDs only as actors, creates synthetic messages and notification events, uses authenticated/anonymous roles, then rolls everything back. It reads no real message contents. Keep the entire transaction together. Any error means the test did not pass; do not publish a success based only on the last SELECT.

For staging a migration without committing it, wrap the migration body and regression checks in one outer transaction, remove their inner BEGIN/COMMIT, and end with ROLLBACK. Existing message-control, receipt, typing and note-ownership SQL regressions should also remain passing.

Manual browser checks should use disposable accounts: direct/group messages, attachment and album previews/downloads, audio/video playback, account switching, receipt updates, reactions/polls and expired media links. Verify malicious names/reactions show literal text and cannot create elements or execute handlers. Do not send test pushes or calls to real users.

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

Short-lived signed URLs do not prevent recipients saving files. Private storage does not hide data from service-role holders. Cached browser data and installed extensions remain device risks. Rate limits, SMTP/recovery delivery, strict CSP, full dependency modernization and true E2EE require further work. Recheck this document after schema, authentication, storage, dependency or hosting changes.
