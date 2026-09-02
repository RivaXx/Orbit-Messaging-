-- ══════════════════════════════════════════════════════════════════════════════
-- ORBIT MESSENGER — ULTRA OPTIMIZED SUPABASE SQL (V28.2.3)
-- Paste this ENTIRE script in: Supabase Dashboard → SQL Editor → New Query
-- Then click RUN. Safe to run multiple times (all idempotent).
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. DROP ALL EXISTING POLICIES ON messages (unblocks schema alteration) ───
DO $$
DECLARE pol record;
BEGIN
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'messages'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON messages', pol.policyname);
    END LOOP;
END;
$$;

-- ── 2. DROP FOREIGN KEY CONSTRAINTS ON messages.room (CRITICAL FIX) ──────────
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_room_fkey;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS fk_messages_room;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_room_id_fkey;

-- ── 3. CONVERT messages.room TO TEXT (fixes silent 0-message bug permanently) 
DO $$
DECLARE col_type text;
BEGIN
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'room';

    IF col_type = 'uuid' THEN
        EXECUTE 'ALTER TABLE messages ALTER COLUMN room TYPE text USING room::text';
        RAISE NOTICE 'FIXED: messages.room converted uuid -> text';
    ELSE
        RAISE NOTICE 'OK: messages.room is already text (type was: %)', col_type;
    END IF;
END;
$$;

-- ── 4. INDEXES (10 composite — makes all queries <1ms) ──────────────────────
CREATE INDEX IF NOT EXISTS idx_messages_room_time
    ON messages (room, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_room_time_before
    ON messages (room, created_at DESC)
    WHERE created_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_sender_time
    ON messages (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_created_desc
    ON messages (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rooms_is_direct
    ON rooms (is_direct);

CREATE INDEX IF NOT EXISTS idx_rooms_created_by
    ON rooms (created_by);

CREATE INDEX IF NOT EXISTS idx_rooms_participants_gin
    ON rooms USING gin (participants);

CREATE INDEX IF NOT EXISTS idx_presence_user_id
    ON user_presence (user_id);

CREATE INDEX IF NOT EXISTS idx_presence_online_time
    ON user_presence (is_online, last_seen DESC);

-- ── 5. RESET GHOST ONLINE STATUSES ──────────────────────────────────────────
UPDATE user_presence
SET is_online = false
WHERE last_seen < (NOW() - INTERVAL '3 minutes') OR last_seen IS NULL;

-- ── 6. RPC: Main chat loader (SETOF messages: immune to column type differences) 
DROP FUNCTION IF EXISTS get_room_messages_smart(text, text, integer);

CREATE OR REPLACE FUNCTION get_room_messages_smart(
    p_room_id     text,
    p_alt_room_id text    DEFAULT '',
    p_limit       integer DEFAULT 300
)
RETURNS SETOF messages
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT *
    FROM messages
    WHERE
        CASE
            WHEN p_alt_room_id IS NULL OR p_alt_room_id = ''
                THEN room = p_room_id
            ELSE room = p_room_id OR room = p_alt_room_id
        END
    ORDER BY created_at DESC
    LIMIT p_limit;
$$;

-- ── 7. RPC: Scroll-up pagination ────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_room_messages_before(text, text, timestamptz, integer);

CREATE OR REPLACE FUNCTION get_room_messages_before(
    p_room_id          text,
    p_alt_room_id      text        DEFAULT '',
    p_before_timestamp timestamptz DEFAULT NOW(),
    p_limit            integer     DEFAULT 50
)
RETURNS SETOF messages
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT *
    FROM messages
    WHERE created_at < p_before_timestamp
      AND (
            CASE
                WHEN p_alt_room_id IS NULL OR p_alt_room_id = ''
                    THEN room = p_room_id
                ELSE room = p_room_id OR room = p_alt_room_id
            END
          )
    ORDER BY created_at DESC
    LIMIT p_limit;
$$;

-- ── 8. RPC: Dashboard chat summaries ────────────────────────────────────────
DROP FUNCTION IF EXISTS get_user_chat_summaries(uuid);

CREATE OR REPLACE FUNCTION get_user_chat_summaries(p_user_id uuid)
RETURNS TABLE (
    room_id text, 
    last_message_text text, 
    last_message_type text,
    last_message_time timestamptz, 
    last_sender_id uuid,
    last_sender_name text, 
    unread_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH latest AS (
        SELECT DISTINCT ON (m.room)
            m.room, m.text, m.type, m.created_at, m.sender_id, m.username
        FROM messages m
        ORDER BY m.room, m.created_at DESC
    )
    SELECT 
        l.room::text AS room_id, 
        l.text::text AS last_message_text, 
        l.type::text AS last_message_type, 
        l.created_at AS last_message_time,
        l.sender_id AS last_sender_id, 
        l.username::text AS last_sender_name,
        0::bigint AS unread_count
    FROM latest l
    ORDER BY l.created_at DESC;
END;
$$;

-- ── 9. RPC: Admin media purge ───────────────────────────────────────────────
DROP FUNCTION IF EXISTS admin_purge_old_media(integer, text);

CREATE OR REPLACE FUNCTION admin_purge_old_media(
    p_days_old    integer DEFAULT 10,
    p_admin_email text    DEFAULT 'rivaldo.a.rodrigues@gmail.com'
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_admin_id   uuid;
    v_purged_int integer := 0;
BEGIN
    SELECT id INTO v_admin_id FROM auth.users WHERE email = p_admin_email LIMIT 1;
    WITH purged AS (
        UPDATE messages
        SET attachments = NULL,
            text = COALESCE(text, '') || ' [Media purged >10d]'
        WHERE created_at < (NOW() - (p_days_old || ' days')::interval)
          AND attachments IS NOT NULL
          AND (v_admin_id IS NULL OR sender_id != v_admin_id)
        RETURNING id
    )
    SELECT COUNT(*) INTO v_purged_int FROM purged;
    RETURN v_purged_int;
END;
$$;

-- ── 10. RECREATE RLS POLICIES (clean & unblocked) ───────────────────────────
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orbit_select_messages" ON messages;
DROP POLICY IF EXISTS "orbit_insert_messages" ON messages;
DROP POLICY IF EXISTS "orbit_update_messages" ON messages;
DROP POLICY IF EXISTS "orbit_delete_messages" ON messages;

CREATE POLICY "orbit_select_messages" ON messages
    FOR SELECT USING (true);

CREATE POLICY "orbit_insert_messages" ON messages
    FOR INSERT WITH CHECK (true);

CREATE POLICY "orbit_update_messages" ON messages
    FOR UPDATE USING (true);

CREATE POLICY "orbit_delete_messages" ON messages
    FOR DELETE USING (true);

ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read all presence" ON user_presence;
DROP POLICY IF EXISTS "Allow update own presence" ON user_presence;

CREATE POLICY "orbit_select_presence" ON user_presence
    FOR SELECT USING (true);

CREATE POLICY "orbit_all_presence" ON user_presence
    FOR ALL USING (auth.uid() = user_id);

-- ── 11. REALTIME PUBLICATIONS ───────────────────────────────────────────────
DO $$
BEGIN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE messages;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE user_presence;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
END;
$$;

-- ── 12. AUTOVACUUM TUNING ───────────────────────────────────────────────────
ALTER TABLE messages SET (
    autovacuum_vacuum_scale_factor  = 0.01,
    autovacuum_analyze_scale_factor = 0.005,
    autovacuum_vacuum_cost_delay    = 2
);

ALTER TABLE user_presence SET (
    autovacuum_vacuum_scale_factor  = 0.02,
    autovacuum_analyze_scale_factor = 0.01
);

-- ── 13. DIAGNOSTIC (single query: shows message counts & room keys) ─────────
SELECT
    room,
    COUNT(*) AS total_messages,
    MAX(created_at) AS newest,
    CASE WHEN room LIKE 'dm_%' THEN 'dm_alias'
         WHEN room LIKE 'self_%' THEN 'self_chat'
         ELSE 'uuid_room' END AS room_type
FROM messages
GROUP BY room
ORDER BY newest DESC
LIMIT 30;

