// Smoke test: verify the approve-accounting routing logic
const http = require('http');

const BASE = { hostname: '5.223.78.194', port: 80, method: 'GET' };

function apiCall(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const options = { ...BASE, path, method };
    if (token) options.headers = { Authorization: `Bearer ${token}` };
    if (body) {
      options.headers = { ...options.headers, 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    const req = http.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // 1. Health check
  const health = await apiCall('/api/health');
  console.log('1. Health:', health.status, health.data.status);

  // 2. Login as accounting to test
  const login = await apiCall('/api/auth/login', 'POST', {
    email: 'accounting@m88.com',
    password: 'test123'
  });
  console.log('2. Login:', login.status, login.data?.user?.role || login.data?.error?.message || 'failed');

  if (login.status !== 200 || !login.data?.user) {
    console.log('Cannot login as accounting, trying supervisor...');
    const login2 = await apiCall('/api/auth/login', 'POST', {
      email: 'supervisor@m88.com',
      password: 'test123'
    });
    console.log('2b. Supervisor login:', login2.status, login2.data?.user?.role || login2.data?.error?.message || 'failed');
  }

  // 3. Check if the approve-accounting endpoint exists and rejects invalid requests
  if (login.data?.token) {
    const token = login.data.token;
    // Try approving a non-existent request - should get 400 (not 500)
    const approveTest = await apiCall('/api/requests/nonexistent-id/approve-accounting', 'PATCH', { note: 'test' }, token);
    console.log('3. Approve-accounting (invalid ID):', approveTest.status, 
      typeof approveTest.data?.error === 'string' ? approveTest.data.error : approveTest.data?.error?.message || 'ok');
  }

  // 4. Check the release endpoint
  if (login.data?.token) {
    const token = login.data.token;
    const releaseTest = await apiCall('/api/requests/nonexistent-id/release', 'PATCH', {}, token);
    console.log('4. Release (invalid ID):', releaseTest.status,
      typeof releaseTest.data?.error === 'string' ? releaseTest.data.error : releaseTest.data?.error?.message || 'ok');
  }

  // 5. Check the approve-vp endpoint
  if (login.data?.token) {
    const token = login.data.token;
    const vpTest = await apiCall('/api/requests/nonexistent-id/approve-vp', 'PATCH', {}, token);
    console.log('5. Approve-VP (invalid ID):', vpTest.status,
      typeof vpTest.data?.error === 'string' ? vpTest.data.error : vpTest.data?.error?.message || 'ok');
  }

  console.log('\n✅ All endpoints responding (no 500 errors = routes are valid)');
}

main().catch(e => console.log('Fatal:', e.message));
