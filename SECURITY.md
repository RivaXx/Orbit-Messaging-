# Orbit security

The Supabase browser `anon` key identifies the project; it is not an administrator secret. Database grants, row-level policies, storage authorization and authenticated server functions enforce access. Never publish service-role keys, passwords, signing secrets or database dumps.

`SECURITY_HARDENING.sql` contains restrictive access boundaries that remain effective alongside older permissive policies. It restricts message access to chat members, writes/deletes to the sender, group identity changes, and media access to authorized participants. Unsafe unused legacy RPCs are revoked. Reactions and votes use authenticated server functions; ordinary media buckets become private. Directory profile photos remain visible to signed-in directory users.

Rollout: install the new server functions before releasing the matching frontend; deploy the frontend's signed-media support; then apply the complete migration including private buckets and sender-only updates. Do not restore public chat buckets to work around preview errors. Fix the access policy or signed-media client instead.

Run `node --test tests/*.test.cjs` and `node tools/security-scan.cjs --history`. The SQL fixture in `tests/security-database.sql` is for a transaction ending in **ROLLBACK**; it creates synthetic users and messages and must never be committed as production data. CI has read-only repository permissions, pinned actions and no deployment secrets. The custom secret scanner detects selected common patterns; it is not exhaustive.

Security limits: Orbit does **not** implement end-to-end message encryption. Authorized service operators can access stored data. Users can retain downloaded files and screenshots; converting a bucket to private cannot recall copies already downloaded or cached. Expiring signed links remain bearer links until expiration. Signed-in directory users can see directory profile information. A static review and synthetic access tests are not a comprehensive penetration test or a historical breach investigation.

Keep GitHub and Supabase accounts protected with two-factor authentication, limit collaborators and keep dependencies updated. Report security issues privately to the repository owner; do not post credentials or private messages in public issues.

References: [Supabase access control](https://supabase.com/docs/guides/api/securing-your-api), [private storage](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Mozilla PDF.js mitigation](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq), [SheetJS browser releases](https://docs.sheetjs.com/docs/getting-started/installation/standalone/).
