// Netlify Functions run in CommonJS; keep this module require()-compatible.
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY;

// Don't throw at module load — Netlify will fail to initialize the function if we throw here.
// Instead export a lightweight stub that returns consistent error objects when env vars are missing.
let supabase;
if (supabaseUrl && supabaseKey) {
  if (process.env.NODE_ENV === 'production' && /localhost|127\.0\.0\.1/i.test(supabaseUrl)) {
    // Defensive: log but continue to avoid crashing the function host; runtime calls will still fail.
    console.warn('Warning: SUPABASE_URL points to localhost in production environment.');
  }
  supabase = createClient(supabaseUrl, supabaseKey);
} else {
  const errObj = { message: 'Missing Supabase environment variables (SUPABASE_URL or SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE).' };
  const asyncErr = async () => ({ data: null, error: errObj });
  const chain = () => ({ select: asyncErr, insert: asyncErr, update: asyncErr, delete: asyncErr, single: asyncErr, maybeSingle: asyncErr, order: () => ({ limit: () => ({ select: asyncErr }), select: asyncErr }), limit: () => ({ select: asyncErr }), eq: () => ({ select: asyncErr }), returns: asyncErr });
  supabase = {
    from: () => chain(),
    rpc: async () => ({ data: null, error: errObj }),
  };
}

module.exports = { supabase };
