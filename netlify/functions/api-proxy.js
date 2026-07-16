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
  
  
  // Build headers to forward — Netlify lowercases all header names
  const fwdHeaders = {};
  if (headers.authorization || headers.Authorization) {
    fwdHeaders['Authorization'] = headers.authorization || headers.Authorization;
  }
  // Check all common casings for content-type
  const ct = headers['content-type'] || headers['Content-Type'] || headers['CONTENT-TYPE'];
  if (ct) fwdHeaders['Content-Type'] = ct;
  
  
  // Process body before creating request so Content-Length is set
  let bodyData = null;
  if (httpMethod !== 'GET' && httpMethod !== 'HEAD' && event.body) {
    bodyData = event.body;
    if (event.isBase64Encoded) {
      bodyData = Buffer.from(bodyData, 'base64');
    } else {
      bodyData = Buffer.from(bodyData, 'utf8');
    }
    fwdHeaders['Content-Length'] = bodyData.length;
  }
  
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
    
    if (bodyData) {
      req.write(bodyData);
    }
    req.end();
  });
};
