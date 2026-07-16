export default async (req, context) => {
  const url = new URL(req.url);
  
  // Extract the path after /api/
  let path = url.pathname;
  path = path.replace(/^\/\.netlify\/functions\/api-proxy/, '');
  path = path.replace(/^\/api/, '');
  if (!path.startsWith('/')) path = '/' + path;
  
  const targetUrl = `http://5.223.78.194:3001/api${path}${url.search}`;
  
  const headers = {};
  const authHeader = req.headers.get('authorization');
  if (authHeader) headers['Authorization'] = authHeader;
  const ctHeader = req.headers.get('content-type');
  if (ctHeader) headers['Content-Type'] = ctHeader;
  
  const fetchOptions = { method: req.method, headers };
  
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      const body = await req.text();
      if (body) fetchOptions.body = body;
    } catch (e) {}
  }
  
  try {
    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.text();
    
    const responseHeaders = { 'Content-Type': response.headers.get('content-type') || 'application/json' };
    
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
