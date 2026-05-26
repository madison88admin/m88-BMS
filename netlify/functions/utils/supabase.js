// Netlify Functions run in CommonJS; keep this module require()-compatible.
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

if (process.env.NODE_ENV === 'production' && /localhost|127\.0\.0\.1/i.test(supabaseUrl)) {
  throw new Error('Production SUPABASE_URL must point to the hosted database, not localhost.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = { supabase };
