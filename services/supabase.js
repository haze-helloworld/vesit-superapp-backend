const { createClient } = require('@supabase/supabase-js');

// Service-role client: backend-only, full access, bypasses RLS.
// This is why every query in the routes below MUST manually
// filter by college_id — Supabase will not do it for you here.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false }
  }
);

module.exports = supabase;
