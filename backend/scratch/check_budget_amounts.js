const { Client } = require('ssh2');
const conn = new Client();

const cmd = `curl -s "http://localhost:3000/api/budget/categories" -H "Content-Type: application/json" 2>&1 | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        print(f'Total categories: {len(data)}')
        for c in data[:10]:
            print(f\"  {c.get('category_code','?')} | {c.get('category_name','?')} | budget={c.get('budget_amount',0)} | used={c.get('used_amount',0)} | dept={c.get('department_id','?')[:8]}\")
    else:
        print('Response:', json.dumps(data)[:500])
except Exception as e:
    print('Parse error:', e)
    print(sys.stdin.read()[:500])
"`;

conn.on('ready', () => {
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    let output = '';
    stream.on('data', d => output += d.toString());
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => {
      console.log(output);
      conn.end();
    });
  });
});

conn.on('error', err => console.error('SSH error:', err.message));
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server**', readyTimeout: 15000 });
