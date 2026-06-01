const { authenticate } = require('./utils/auth');
const { PRESIDENT_THRESHOLD } = require('./utils/approval');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    authenticate(event.headers.authorization);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        president_threshold: PRESIDENT_THRESHOLD,
        thresholds: {
          PHP: { vp: PRESIDENT_THRESHOLD, president: PRESIDENT_THRESHOLD },
          USD: { vp: PRESIDENT_THRESHOLD, president: PRESIDENT_THRESHOLD },
          IDR: { vp: PRESIDENT_THRESHOLD, president: PRESIDENT_THRESHOLD },
        },
        exchange_rates: {
          PHP: 1,
          USD: 0.018,
          IDR: 291,
        },
        default_currency: 'PHP',
      }),
    };
  } catch (error) {
    const statusCode = error.message === 'Access denied' || error.message === 'Invalid token' ? 401 : 500;
    return { statusCode, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
};
