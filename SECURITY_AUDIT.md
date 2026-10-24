# Orbit security audit

Date: 24 October 2026. Release: `security-audit-20261024-r1`.

## Result

The application has server access controls, but it is not end-to-end encrypted. This update addresses confirmed authorization and rendering weaknesses. It does not make Orbit unhackable, certify all dependencies, or replace an independent penetration test.

## Scope and method

Reviewed browser messaging/authentication/media/call/notification code, repository SQL, edge functions, service-worker caching and deployment headers. Read production policy, function, grant, trigger and bucket metadata without exporting conversation contents. Authorization tests use synthetic messages, existing actor IDs only, explicit database roles and a rolled-back transaction. No real files were downloaded and no production chats or accounts were purged. An aggregate compatibility check found no legacy non-UUID owner-folder paths among existing chat/media objects. External anonymous table probes and unauthorized edge-function requests were also denied with HTTP 401. Database-role tests supply the cross-user authorization evidence.

A pattern scan covered 400 distinct reachable text blobs across fetched Git refs. It found no service-role JWTs, GitHub tokens or private-key blocks. Public anon-key occurrences are expected. This was a limited pattern scan: ignored files, unreachable remote/deleted history, arbitrary secret formats and third-party infrastructure were not exhaustively assessed.

## Findings and disposition

| ID | Severity | Finding | Change / remaining status |
|---|---|---|---|
| SEC-01 | High requirement gap | Stored message text is readable by the backend despite the former E2EE badge. | Corrected the label. Genuine E2EE remains **open**; see CHAT_ENCRYPTION.md. |
| SEC-02 | High | `chat-assets`, `voice-notes`, `files` and `uploads` were public. Public downloads bypass SELECT RLS. | Migration makes these buckets private; client resolves authorized short-lived URLs, including legacy media links. Profile photos are preserved. |
| SEC-03 | High | Existing edit guards did not comprehensively prevent a recipient changing media captions/attachments and other shared content. | New invoker trigger restricts direct recipient updates to receipts; shared reactions and votes use checked RPCs. Initial reactions/votes are reset, and sender forgery remains blocked. |
| SEC-04 | High | Attachment URLs, reaction strings and handler arguments crossed HTML/JavaScript contexts unsafely. | Encoded unsafe URL delimiters, rejected active schemes/control characters, escaped reaction markup, serialized filename/contact arguments safely and escaped error text in the reviewed paths. Regression payloads remain inert. |
| SEC-05 | High | PDF.js 3.11.174 is in the affected range for CVE-2024-4367 with default evaluation enabled. | Disabled evaluation and XFA in the document-loading call, applying the upstream workaround. Full PDF.js modernization remains recommended. |
| SEC-06 | Medium | Group fast previews, vote/reaction broadcasts could supply unconfirmed content; the legacy chat-stream channel was not explicitly private. | Private chat-stream subscription and database-confirmed message refresh. Peer payloads no longer directly establish message or vote content. |
| SEC-07 | Medium | Browser roles had unnecessary table privileges including TRUNCATE; RLS does not govern TRUNCATE. | Revoked TRUNCATE, REFERENCES and TRIGGER privileges from browser roles. |
| SEC-08 | Medium | No application security-header configuration; inline code remains extensive. | Added anti-framing, MIME sniffing, referrer and baseline CSP protections. CSP still permits inline scripts and broad HTTPS connections for existing features; it is **not** a strict XSS boundary. |
| SEC-09 | Low / defense in depth | Push sender validated the database endpoint but passed a separate subscription object to the push library. Database constraints already require equality. | Added an independent endpoint-equality check and hostile-destination regression tests in the edge function. |
| SEC-10 | Medium / dependency maintenance | Spreadsheet preview used SheetJS 0.18.5 from a CDN. | Updated the loader to the official pinned 0.20.3 standalone URL and pinned integrity hashes for dynamically loaded PDF, cropper and spreadsheet scripts. The official bundle download, version marker and a CSV parse were verified. No full dependency-security certification is implied. |

## Existing protections observed

All 28 inspected public tables had RLS enabled. Restrictive anonymous-denial policies and authenticated membership boundaries already protect messaging even where older permissive policies remain. Sensitive legacy admin/feed RPCs inspected in production were service-only. Private view-once photo delivery verifies the user's token and calls a membership/consumption function. Notification text for ordinary messages is generic. Push destinations have a provider-host allowlist. The service worker avoids caching authenticated API responses and chat media.

## Open priorities

1. Implement and independently review true E2EE before promising server-blind chat privacy.
2. Remove remaining inline event handlers and render untrusted content with DOM APIs throughout the application; move to a nonce/hash-based strict CSP. This audit fixed identified paths, not every possible DOM sink.
3. Replace/modernize the legacy PDF library and maintain a dependency inventory with regular advisory review. Retest spreadsheet formats in supported browsers after dependency changes.
4. Add server-enforced per-account abuse/storage/message limits and monitoring. Platform authentication rate limits alone do not prevent a signed-in user exhausting free-plan quotas.
5. Review directory email/presence exposure and enforce privacy preferences in backend queries/policies. Client-side last-seen hiding is not a confidentiality boundary.
6. Review account recovery, SMTP delivery, provider redirects, MFA for maintainers, session revocation and backup recovery operationally. No new SMTP provider was configured by this audit.
7. Plan local-data protection and shared-device behavior. Browser storage contains readable cache/draft/session data; do not confuse it with E2EE.

## Verification

Automated coverage includes malicious URL delimiters/schemes, handler filenames, legacy reaction markup, cross-project signing rejection, account-switch signing races, confirmed realtime records and push endpoint mismatch. SQL tests check recipient tampering, sender impersonation, forged initial votes/reactions, authorized receipts/votes/reactions, outsider and anonymous reads, unshared media isolation, private bucket configuration and browser-role least privilege. See SECURITY_OPERATIONS.md for commands, deployment order and limitations.

Sources: [public versus private storage](https://supabase.com/docs/guides/storage/buckets/fundamentals), [database function security](https://supabase.com/docs/guides/database/functions), [OWASP context-sensitive XSS defenses](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html), [Mozilla PDF.js advisory and workaround](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq), [official SheetJS standalone distribution](https://docs.sheetjs.com/docs/getting-started/installation/standalone/).
