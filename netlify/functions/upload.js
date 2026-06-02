const { supabase } = require('./utils/supabase');
const { authenticate } = require('./utils/auth');
const multipart = require('parse-multipart');

const defaultHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const getBoundary = (contentType) => {
  if (!contentType) return null;
  const match = /boundary=(.*)$/i.exec(contentType);
  return match ? match[1] : null;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: defaultHeaders,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const token = event.headers.authorization || event.headers.Authorization;
    if (!token) {
      return {
        statusCode: 401,
        headers: defaultHeaders,
        body: JSON.stringify({ error: 'Authorization header is required' }),
      };
    }

    const user = authenticate(token);
    if (!user) {
      return {
        statusCode: 401,
        headers: defaultHeaders,
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    const boundary = getBoundary(contentType);
    if (!boundary) {
      throw new Error('Missing multipart boundary');
    }

    const bodyBuffer = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8');
    const parts = multipart.Parse(bodyBuffer, boundary);
    const filePart = parts.find((part) => part.filename);
    if (!filePart) {
      return {
        statusCode: 400,
        headers: defaultHeaders,
        body: JSON.stringify({ error: 'No file provided' }),
      };
    }

    const filename = filePart.filename || 'upload.bin';
    const mimetype = filePart.type || 'application/octet-stream';
    const fileBuffer = filePart.data;
    const ext = filename.split('.').pop() || 'bin';
    const safeFileName = `${Math.random().toString(36).slice(2)}_${Date.now()}.${ext}`;
    const filePath = `attachments/${safeFileName}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('attachments')
      .upload(filePath, fileBuffer, {
        contentType: mimetype,
        upsert: false,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data: publicData, error: publicError } = supabase.storage
      .from('attachments')
      .getPublicUrl(filePath);

    if (publicError) {
      throw publicError;
    }
    if (!publicData || !publicData.publicUrl) {
      throw new Error('Failed to generate public URL');
    }

    return {
      statusCode: 200,
      headers: defaultHeaders,
      body: JSON.stringify({
        file_name: filename,
        file_url: publicData.publicUrl,
        attachment_type: mimetype,
        attachment_scope: 'request',
      }),
    };
  } catch (err) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};
