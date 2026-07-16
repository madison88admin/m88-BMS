export default async (req, context) => {
  // Get the original URL path from the request
  const rawUrl = req.url || '';
  let url;
  try {
    url = new URL(rawUrl);
  } catch (e) {
    url = new URL(rawUrl, 'http://localhost');
  }
  
  // The original path should be in the URL - extract everything after /api
  let path = url.pathname || '';
  // Remove function path prefix if present
  path = path.replace(/^\/\.netlify\/functions\/api-proxy/, '');
  // Remove /api prefix
  path = path.replace(/^\/api/, '');
  // Ensure starts with /
  if (!path || !path.startsWith('/')) path = '/' + (path || '');
  
  const search = url.search || '';
  const targetUrl = `http://5.223.78.194/api${path}${search}`;
  
  // Forward headers
  const headers = {};
  try {
    const authHeader = req.headers.get('authorization');
    if (authHeader) headers['Authorization'] = authHeader;
    const ctHeader = req.headers.get('content-type');
    if (ctHeader) headers['Content-Type'] = ctHeader;
  } catch (e) {}
  
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
    const contentType = response.headers.get('content-type') || 'application/json';
    
    return new Response(data, {
      status: response.status,
      headers: { 'Content-Type': contentType },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Proxy error: ' + (err.message || err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
