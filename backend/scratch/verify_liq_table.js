const { Client } = require('ssh2');
const conn = new Client();

const cmd = `docker exec supabase-db psql -U postgres -d postgres -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='M88_BMS' AND table_name='liquidation_items' ORDER BY ordinal_position;" 2>&1 && echo "---" && docker exec supabase-db psql -U postgres -d postgres -c "SELECT column_name FROM information_schema.columns WHERE table_schema='M88_BMS' AND table_name='request_liquidations' AND column_name LIKE 'cash_return%';" 2>&1`;

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
