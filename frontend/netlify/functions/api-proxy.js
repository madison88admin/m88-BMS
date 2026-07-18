export default async (req, context) => {
  const backendBaseUrl = Netlify.env.get('BACKEND_API_URL') || 'http://5.223.78.194:3001';
  const url = new URL(req.url);
  
  // Extract the path after /api/ — handle different Netlify function URL formats
  let path = url.pathname;
  // Remove function prefix if present
  path = path.replace(/^\/\.netlify\/functions\/api-proxy/, '');
  // Remove /api prefix if present  
  path = path.replace(/^\/api/, '');
  // Ensure path starts with /
  if (!path.startsWith('/')) path = '/' + path;
  
  const targetUrl = `${backendBaseUrl.replace(/\/$/, '')}/api${path}${url.search}`;
  
  // Forward auth and content-type headers
  const headers = {};
  const authHeader = req.headers.get('authorization');
  if (authHeader) headers['Authorization'] = authHeader;
  const ctHeader = req.headers.get('content-type');
  if (ctHeader) headers['Content-Type'] = ctHeader;
  
  const fetchOptions = {
    method: req.method,
    headers,
  };
  
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      const body = await req.text();
      if (body) fetchOptions.body = body;
    } catch (e) {
      // No body
    }
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
