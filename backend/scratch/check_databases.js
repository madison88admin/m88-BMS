const { Client } = require('ssh2');
const conn = new Client();

const cmd = `docker exec supabase-db psql -U postgres -d postgres -c "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;" 2>&1 && echo "---" && docker exec supabase-db psql -U postgres -d postgres -c "SELECT schemaname, tablename FROM pg_tables WHERE tablename LIKE '%budget%' OR tablename LIKE '%expense%' OR tablename LIKE '%department%' ORDER BY schemaname, tablename;" 2>&1 && echo "---" && journalctl -u bms-backend --no-pager -n 20 2>&1`;

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
