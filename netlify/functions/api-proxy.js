const http = require('http');

exports.handler = async (event, context) => {
  const path = event.path || '';
  const httpMethod = event.httpMethod || 'GET';
  const queryString = event.queryStringParameters || {};
  const headers = event.headers || {};
  
  // Extract path after /api
  let apiPath = path.replace(/^\/api/, '');
  if (!apiPath.startsWith('/')) apiPath = '/' + apiPath;
  
  // Build query string
  const qs = Object.keys(queryString).map(k => `${k}=${encodeURIComponent(queryString[k])}`).join('&');
  const targetUrl = `http://5.223.78.194/api${apiPath}${qs ? '?' + qs : ''}`;
  
  // Build headers to forward
  const fwdHeaders = {};
  if (headers.authorization) fwdHeaders['Authorization'] = headers.authorization;
  if (headers['content-type']) fwdHeaders['Content-Type'] = headers['content-type'];
  
  return new Promise((resolve) => {
    const urlObj = new URL(targetUrl);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname + urlObj.search,
      method: httpMethod,
      headers: fwdHeaders,
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: { 'Content-Type': res.headers['content-type'] || 'application/json' },
          body: data,
        });
      });
    });
    
    req.on('error', (err) => {
      resolve({
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Proxy error: ' + err.message }),
      });
    });
    
    if (httpMethod !== 'GET' && event.body) {
      req.write(event.body);
    }
    req.end();
  });
};
