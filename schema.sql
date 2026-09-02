-- ══════════════════════════════════════════════════════════════════════════════
-- ORBIT MESSENGER (V26.1.0) — SUPABASE SQL SCHEMA & OPTIMIZATIONS
-- Run these queries in your Supabase Project -> SQL Editor
-- ══════════════════════════════════════════════════════════════════════════

-- 1. EXTENDED COLUMNS FOR PROFILES & USERNAMES
ALTER TABLE IF EXISTS user_profiles ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE IF EXISTS user_profiles ADD COLUMN IF NOT EXISTS about text DEFAULT 'Hey there! I am using Orbit.';
ALTER TABLE IF EXISTS user_profiles ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE IF EXISTS user_profiles ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE IF EXISTS user_profiles ADD COLUMN IF NOT EXISTS dp_url text;
ALTER TABLE IF EXISTS user_profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE IF EXISTS user_presence ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE IF EXISTS user_presence ADD COLUMN IF NOT EXISTS about text DEFAULT 'Hey there! I am using Orbit.';
ALTER TABLE IF EXISTS user_presence ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE IF EXISTS user_presence ADD COLUMN IF NOT EXISTS dp_url text;
ALTER TABLE IF EXISTS user_presence ADD COLUMN IF NOT EXISTS is_online boolean DEFAULT false;
ALTER TABLE IF EXISTS user_presence ADD COLUMN IF NOT EXISTS last_seen timestamptz DEFAULT now();
ALTER TABLE IF EXISTS user_presence ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Unique index for case-insensitive reserved usernames
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(lower(username)) WHERE username IS NOT NULL;

-- 2. CORE TABLES (Rooms, Members, Messages, Notes, Friends)
CREATE TABLE IF NOT EXISTS rooms (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  topic text,
  dp_url text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_direct boolean DEFAULT false,
  participants uuid[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "All authenticated view rooms" ON rooms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated create rooms" ON rooms FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Creator or member update rooms" ON rooms FOR UPDATE TO authenticated USING (auth.uid() = created_by OR auth.uid() = ANY(participants));
CREATE POLICY "Creator delete rooms" ON rooms FOR DELETE TO authenticated USING (auth.uid() = created_by);

CREATE TABLE IF NOT EXISTS room_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role text DEFAULT 'member',
  joined_at timestamptz DEFAULT now(),
  UNIQUE(room_id, user_id)
);
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "All authenticated view members" ON room_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated join or add members" ON room_members FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Members leave or delete" ON room_members FOR DELETE TO authenticated USING (auth.uid() = user_id OR true);

CREATE TABLE IF NOT EXISTS messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  room text NOT NULL,
  sender_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  username text,
  text text,
  type text DEFAULT 'text',
  attachments jsonb,
  reactions jsonb DEFAULT '{}',
  reply_to jsonb,
  deleted_by uuid[] DEFAULT '{}',
  read_by uuid[] DEFAULT '{}',
  metadata jsonb,
  pinned boolean DEFAULT false,
  is_encrypted boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "All authenticated view messages" ON messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated send messages" ON messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "Authenticated update messages" ON messages FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Sender delete messages" ON messages FOR DELETE TO authenticated USING (auth.uid() = sender_id);

CREATE TABLE IF NOT EXISTS friends (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, friend_id)
);
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage friendships" ON friends FOR ALL TO authenticated USING (auth.uid() = user_id OR auth.uid() = friend_id);

CREATE TABLE IF NOT EXISTS secure_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text,
  content text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE secure_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own notes" ON secure_notes FOR ALL TO authenticated USING (auth.uid() = user_id);

-- 3. HIGH PERFORMANCE SCALE INDEXES
CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_room_members_room_id ON room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_user_presence_user_id ON user_presence(user_id);
CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen ON user_presence(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_user_presence_updated ON user_presence(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_friends_uid_fid ON friends(user_id, friend_id);

-- 4. USER SELF ACCOUNT DELETION FUNCTION
CREATE OR REPLACE FUNCTION self_delete_account()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM messages WHERE sender_id = uid;
  DELETE FROM room_members WHERE user_id = uid;
  DELETE FROM rooms WHERE created_by = uid;
  DELETE FROM friends WHERE user_id = uid OR friend_id = uid;
  DELETE FROM secure_notes WHERE user_id = uid;
  DELETE FROM user_profiles WHERE user_id = uid;
  DELETE FROM user_presence WHERE user_id = uid;

  RETURN json_build_object('status', 'success', 'user_id', uid, 'deleted_at', now());
END;
$$;

-- 5. ADMIN INACTIVE ACCOUNT DELETION FUNCTION (rivaldo.a.rodrigues@gmail.com)
CREATE OR REPLACE FUNCTION admin_delete_user_data(target_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_user_email text;
BEGIN
  SELECT email INTO deleted_user_email FROM user_presence WHERE user_id = target_user_id;

  DELETE FROM messages WHERE sender_id = target_user_id;
  DELETE FROM room_members WHERE user_id = target_user_id;
  DELETE FROM rooms WHERE created_by = target_user_id;
  DELETE FROM friends WHERE user_id = target_user_id OR friend_id = target_user_id;
  DELETE FROM secure_notes WHERE user_id = target_user_id;
  DELETE FROM user_profiles WHERE user_id = target_user_id;
  DELETE FROM user_presence WHERE user_id = target_user_id;

  RETURN json_build_object(
    'status', 'success',
    'deleted_user_id', target_user_id,
    'email', deleted_user_email,
    'deleted_at', now()
  );
END;
$$;
