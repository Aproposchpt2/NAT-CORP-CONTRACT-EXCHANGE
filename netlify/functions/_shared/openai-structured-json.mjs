// Shared OpenAI Responses API helper for strict machine-readable output.
// Every caller supplies its own JSON Schema and existing business normalization.
// This helper only enforces the transport/output contract and handles transient
// incomplete/empty/invalid structured responses with one controlled retry.
//
// Ported verbatim from APROPOS-CONTRACT-BRIEF's openai-structured-json.mjs
// (natcorp execution path) -- generic, no natcorp/cbrief-specific logic.

function responseText(message) {
  if (typeof message?.output_text === 'string' && message.output_text.trim()) return message.output_text;
  const parts = [];
  for (const item of message?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && content.text) parts.push(content.text);
    }
  }
  return parts.join('\n');
}

function responseRefusal(message) {
  for (const item of message?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'refusal' && content.refusal) return String(content.refusal);
    }
  }
  return '';
}

function parseStructuredResponse(message, errorPrefix) {
  if (message?.status === 'incomplete') {
    const reason = message?.incomplete_details?.reason || 'unknown';
    throw new Error(`${errorPrefix}_INCOMPLETE:${reason}`);
  }
  if (message?.status === 'failed') {
    const code = message?.error?.code || 'unknown';
    const detail = message?.error?.message || 'Response generation failed.';
    throw new Error(`${errorPrefix}_RESPONSE_FAILED:${code}:${String(detail).slice(0, 300)}`);
  }
  const refusal = responseRefusal(message);
  if (refusal) throw new Error(`${errorPrefix}_REFUSAL:${refusal.slice(0, 300)}`);

  const text = responseText(message).trim();
  if (!text) throw new Error(`${errorPrefix}_OUTPUT_EMPTY`);
  try {
    return JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${errorPrefix}_JSON_INVALID:${detail}`);
  }
}

function isRetryableStructuredError(error, errorPrefix) {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith(`${errorPrefix}_INCOMPLETE:`)
    || message === `${errorPrefix}_OUTPUT_EMPTY`
    || message.startsWith(`${errorPrefix}_JSON_INVALID:`);
}

export async function requestStructuredJson({
  apiKey,
  model,
  system,
  prompt,
  schemaName,
  schema,
  errorPrefix,
  fetchImpl = fetch,
  timeoutMs = 90000,
  maxOutputTokens = 4000,
  retries = 1,
}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY_REQUIRED');
  if (!schemaName || !schema || !errorPrefix) throw new Error('STRUCTURED_OUTPUT_CONFIGURATION_REQUIRED');

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`${errorPrefix}_TIMEOUT`)), timeoutMs);
    try {
      const response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          store: false,
          reasoning: { effort: 'low' },
          input: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: schemaName,
              strict: true,
              schema,
            },
          },
          max_output_tokens: maxOutputTokens,
        }),
        signal: controller.signal,
      });
      const bodyText = await response.text();
      if (!response.ok) throw new Error(`${errorPrefix}_FAILED:${response.status}:${bodyText.slice(0, 500)}`);

      let message;
      try {
        message = JSON.parse(bodyText);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${errorPrefix}_API_JSON_INVALID:${detail}`);
      }

      try {
        return parseStructuredResponse(message, errorPrefix);
      } catch (error) {
        lastError = error;
        if (attempt >= retries || !isRetryableStructuredError(error, errorPrefix)) throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error(`${errorPrefix}_STRUCTURED_OUTPUT_FAILED`);
}
