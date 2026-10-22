# Photo albums, typing and daily startup

- Each delivered photo album has Download photos, followed by Save ZIP. One archive preserves all downloaded file bytes and filenames with unique prefixes. A separate Save tap works with mobile download gesture restrictions. Preparation is limited to 100 photos / 100 MB; failed files produce a retry rather than a partial archive. View-once media is excluded.
- New photo attachments persist SD, HD or Original mode, including mixed-quality albums. Each tile displays its own label. Old attachments without recorded quality remain unlabelled rather than guessed. Existing original-quality quotas are unchanged.
- Typing waits for old private subscriptions to leave, retries failed/expired connections with bounded backoff, and recovers on reconnect/resume. A full draft-storage quota cannot suppress typing. Known direct-message peers are no longer classified as groups when room metadata has not arrived. Existing participant authorization remains required; no drafts are broadcast.
- Cached navigation returns immediately while updating in the background. Remembered sessions display their local shell during hourly token refresh; all server I/O still uses Supabase authentication/RLS. Explicit logout and the six-day inactivity limit remain. Optional suites start after the cached shell; the hidden directory is no longer rendered during launch. The introduction animation is unchanged.

## Validation

148 Node regression tests passed, including ZIP structure/CRC, complete versus failed downloads, view-once exclusion, quality persistence, typing rejoin/retry/storage failures and cached startup with an indefinitely stalled network. A 390px browser preview successfully downloaded a four-photo ZIP and showed mixed-quality labels. Live two-account typing and physical-phone startup timing still require device verification; local tests do not establish an instant-start guarantee.

No database migration or production data deletion is included.
