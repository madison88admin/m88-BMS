const { Client } = require('ssh2');
const conn = new Client();

const cmd = `docker exec supabase-db psql -U postgres -d postgres -c "ALTER TABLE \\"M88_BMS\\".request_liquidations ADD COLUMN IF NOT EXISTS cash_return_method text DEFAULT NULL; ALTER TABLE \\"M88_BMS\\".request_liquidations ADD COLUMN IF NOT EXISTS cash_return_reference text DEFAULT NULL; ALTER TABLE \\"M88_BMS\\".request_liquidations ADD COLUMN IF NOT EXISTS cash_return_acknowledged_at timestamp with time zone DEFAULT NULL; ALTER TABLE \\"M88_BMS\\".request_liquidations ADD COLUMN IF NOT EXISTS liquidation_status text DEFAULT 'submitted'; NOTIFY pgrst, 'reload schema';" 2>&1`;

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
