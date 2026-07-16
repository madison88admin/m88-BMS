export default async (req, context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, '');
  const targetUrl = `http://5.223.78.194:3001/api${path}${url.search}`;
  
  // Forward the request to VPS
  const headers = {};
  if (req.headers.get('authorization')) {
    headers['Authorization'] = req.headers.get('authorization');
  }
  if (req.headers.get('content-type')) {
    headers['Content-Type'] = req.headers.get('content-type');
  }
  
  const fetchOptions = {
    method: req.method,
    headers,
  };
  
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const body = await req.text();
    fetchOptions.body = body;
  }
  
  try {
    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.text();
    
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    
    return new Response(data, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Proxy error: ' + err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
