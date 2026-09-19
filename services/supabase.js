const { createClient } = require('@supabase/supabase-js');

// Ensure WebSocket compatibility for Node environments without native WebSocket
if (typeof global !== 'undefined' && !global.WebSocket) {
  global.WebSocket = class DummyWebSocket {};
}

// Service-role client: backend-only, full access, bypasses RLS.
// This is why every query in the routes below MUST manually
// filter by college_id — Supabase will not do it for you here.
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'placeholder-service-key',
  {
    auth: { persistSession: false }
  }
);

module.exports = supabase;
