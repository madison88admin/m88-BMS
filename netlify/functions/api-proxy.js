const http = require('http');

exports.handler = async (event, context) => {
  // event.path contains the original request path when using rewrite
  // Try multiple sources to find the original /api/* path
  let path = event.path || '';
  
  // If path is the function path, try rawUrl or resource
  if (path.includes('/.netlify/functions/')) {
    path = event.rawUrl || event.resource || '';
  }
  
  // Also try event.multiValueHeaders for original URL
  if (path.includes('/.netlify/functions/') && event.headers && event.headers['x-netlify-original-path']) {
    path = event.headers['x-netlify-original-path'];
  }
  
  console.log('Proxy event:', JSON.stringify({ 
    path: event.path, 
    rawUrl: event.rawUrl, 
    resource: event.resource,
    httpMethod: event.httpMethod 
  }));
  
  const httpMethod = event.httpMethod || 'GET';
  const queryString = event.queryStringParameters || {};
  const headers = event.headers || {};
  
  // Extract path after /api
  let apiPath = path.replace(/^\/api/, '');
  // Remove any function prefix
  apiPath = apiPath.replace(/^\/\.netlify\/functions\/api-proxy/, '');
  apiPath = apiPath.replace(/^\/api/, '');
  if (!apiPath.startsWith('/')) apiPath = '/' + apiPath;
  
  // Build query string
  const qs = Object.keys(queryString).map(k => `${k}=${encodeURIComponent(queryString[k])}`).join('&');
  const targetPath = `/api${apiPath}${qs ? '?' + qs : ''}`;
  
  console.log('Proxy target:', `http://5.223.78.194${targetPath}`);
  
  // Build headers to forward
  const fwdHeaders = {};
  if (headers.authorization) fwdHeaders['Authorization'] = headers.authorization;
  if (headers['content-type']) fwdHeaders['Content-Type'] = headers['content-type'];
  
  return new Promise((resolve) => {
    const options = {
      hostname: '5.223.78.194',
      port: 80,
      path: targetPath,
      method: httpMethod,
      headers: fwdHeaders,
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log('Proxy response status:', res.statusCode, 'length:', data.length);
        resolve({
          statusCode: res.statusCode,
          headers: { 'Content-Type': res.headers['content-type'] || 'application/json' },
          body: data,
        });
      });
    });
    
    req.on('error', (err) => {
      console.error('Proxy error:', err.message);
      resolve({
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Proxy error: ' + err.message }),
      });
    });
    
    if (httpMethod !== 'GET' && httpMethod !== 'HEAD' && event.body) {
      let body = event.body;
      // Netlify may base64-encode the body
      if (event.isBase64Encoded) {
        body = Buffer.from(body, 'base64').toString('utf8');
      }
      req.write(body);
    }
    req.end();
  });
};
