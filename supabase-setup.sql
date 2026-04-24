-- ─────────────────────────────────────────────────────────────
-- FamPlan – Supabase SQL Setup
-- Run this in your Supabase project: SQL Editor → New Query → Run
-- ─────────────────────────────────────────────────────────────

-- 1. Create the state table
CREATE TABLE IF NOT EXISTS famplan_state (
  family_id   TEXT PRIMARY KEY,
  state       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Enable Row Level Security (keeps data private)
ALTER TABLE famplan_state ENABLE ROW LEVEL SECURITY;

-- 3. Allow anyone with the anon key to read/write their own family
--    (The family_id acts as a simple password — keep yours unique!)
CREATE POLICY "family read"  ON famplan_state FOR SELECT USING (true);
CREATE POLICY "family write" ON famplan_state FOR INSERT WITH CHECK (true);
CREATE POLICY "family update" ON famplan_state FOR UPDATE USING (true);

-- 4. Enable real-time for this table
ALTER PUBLICATION supabase_realtime ADD TABLE famplan_state;

-- 5. Optional: auto-update the updated_at column
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER famplan_updated_at
  BEFORE UPDATE ON famplan_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- That's it! Your table is ready.
-- Copy your Project URL and anon key from:
-- Supabase Dashboard → Settings → API
