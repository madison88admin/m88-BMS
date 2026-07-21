const { Client } = require('ssh2');
const conn = new Client();

const sql = `
-- Add cash_return_method column to request_liquidations
ALTER TABLE "M88_BMS".request_liquidations 
  ADD COLUMN IF NOT EXISTS cash_return_method text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cash_return_reference text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cash_return_acknowledged_at timestamp with time zone DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS liquidation_status text DEFAULT 'submitted';

-- Create liquidation_items table for multiple expense items per liquidation
CREATE TABLE IF NOT EXISTS "M88_BMS".liquidation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  liquidation_id uuid NOT NULL REFERENCES "M88_BMS".request_liquidations(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  category text,
  receipt_url text,
  receipt_file_name text,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_liquidation_items_liquidation_id ON "M88_BMS".liquidation_items(liquidation_id);

-- Enable RLS
ALTER TABLE "M88_BMS".liquidation_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow all for M88_BMS" ON "M88_BMS".liquidation_items FOR ALL USING (true) WITH CHECK (true);

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
`;

const cmd = `docker exec supabase-db psql -U postgres -d postgres -c "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}" 2>&1`;

conn.on('ready', () => {
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    let output = '';
    stream.on('data', d => output += d.toString());
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => { console.log(output); conn.end(); });
  });
});
conn.on('error', err => console.error('SSH error:', err.message));
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server**', readyTimeout: 15000 });
