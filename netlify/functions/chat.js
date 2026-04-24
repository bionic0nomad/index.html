// Netlify Function — Anthropic proxy for the Daleel chatbot.
// Reads ANTHROPIC_API_KEY from Netlify env vars and forwards the request
// server-side, so the key is never shipped to the browser.
//
// Env vars required on Netlify:
//   ANTHROPIC_API_KEY    (required)   sk-ant-... key from console.anthropic.com
//
// POST body: { messages: [...], system: "..." }
//
// This function caps input size to keep the endpoint from being abused as a
// free LLM proxy by anyone who finds the URL.

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 350;
const MAX_SYSTEM_CHARS = 4000;
const MAX_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 2000;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'ANTHROPIC_API_KEY not configured on Netlify' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON body' });
  }

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = rawMessages
    .slice(-MAX_MESSAGES)
    .filter(function (m) {
      return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
    })
    .map(function (m) {
      return { role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) };
    });

  if (messages.length === 0) {
    return json(400, { error: 'At least one message with role user/assistant is required' });
  }

  const system = typeof body.system === 'string'
    ? body.system.slice(0, MAX_SYSTEM_CHARS)
    : '';

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: system,
        messages: messages
      })
    });

    const text = await resp.text();
    return {
      statusCode: resp.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: text
    };
  } catch (err) {
    return json(502, { error: 'Upstream Anthropic call failed', detail: String(err && err.message || err) });
  }
};

function json(statusCode, payload) {
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(payload)
  };
}
