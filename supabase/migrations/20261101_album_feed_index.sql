-- Repair oversized encrypted album inserts. Large ciphertext/attachment values
-- belong in the table, never in a B-tree's key or INCLUDE payload.
-- No chat rows, media objects, accounts, grants, policies or keys are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE old_index oid := to_regclass('public.idx_messages_feed_covering');
BEGIN
  IF old_index IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = old_index
      AND i.indrelid = 'public.messages'::regclass
      AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conindid = old_index)
  ) THEN
    RAISE EXCEPTION 'Unexpected covering index ownership/constraint. Nothing was changed; inspect pg_get_indexdef before proceeding.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS orbit_messages_feed_cursor_v2
ON public.messages (room, created_at DESC, id DESC);

DO $$
DECLARE key_columns text[];
BEGIN
  SELECT array_agg(a.attname::text ORDER BY k.position) INTO key_columns
  FROM pg_catalog.pg_index i
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
  JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE i.indexrelid = 'public.orbit_messages_feed_cursor_v2'::regclass
    AND i.indrelid = 'public.messages'::regclass
    AND i.indnatts = 3 AND i.indnkeyatts = 3 AND i.indisvalid
    AND NOT i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL;
  IF key_columns IS DISTINCT FROM ARRAY['room', 'created_at', 'id']::text[] THEN
    RAISE EXCEPTION 'Unexpected replacement index. Nothing was changed.';
  END IF;
END $$;

-- The replacement is present before removing the non-constraint covering index.
-- There is deliberately no CASCADE and no table/data deletion.
DROP INDEX IF EXISTS public.idx_messages_feed_covering;
COMMENT ON INDEX public.orbit_messages_feed_cursor_v2 IS
  'Chat feed cursor only: room, created_at, id. Never INCLUDE ciphertext, attachments or other unbounded payloads.';
COMMIT;

SELECT 'album_index_repair_complete' AS result,
       pg_get_indexdef('public.orbit_messages_feed_cursor_v2'::regclass) AS feed_index,
       to_regclass('public.idx_messages_feed_covering') IS NULL AS oversized_index_removed;
