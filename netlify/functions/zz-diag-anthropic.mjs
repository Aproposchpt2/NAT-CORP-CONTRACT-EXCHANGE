// TEMPORARY diagnostic function, added 2026-08-25 to determine why
// aoie-llm-relevance-run-background.mjs was failing every single
// judgeRelevance() call with no clear code-level cause. Makes ONE minimal
// Claude API call (tiny prompt, low max_tokens) using the exact same
// ANTHROPIC_API_KEY and model this feature uses, and returns only the
// HTTP status and a truncated error body -- never the key itself. Meant
// to be deployed, hit once, and DELETED immediately after -- not meant to
// stay in production.
import { env, json, sameOrigin } from './_shared/natcorp-db.mjs';

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin.' });
  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) return json(500, { ok: false, error: 'ANTHROPIC_API_KEY not configured.' });
  const model = env('AOIE_LLM_RELEVANCE_MODEL') || 'claude-opus-5';

  try {
    const started = Date.now();
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const elapsedMs = Date.now() - started;
    const bodyText = await response.text();
    return json(200, {
      ok: true,
      model,
      httpStatus: response.status,
      httpOk: response.ok,
      elapsedMs,
      rateLimitHeaders: {
        requestsRemaining: response.headers.get('anthropic-ratelimit-requests-remaining'),
        requestsLimit: response.headers.get('anthropic-ratelimit-requests-limit'),
        tokensRemaining: response.headers.get('anthropic-ratelimit-tokens-remaining'),
        tokensLimit: response.headers.get('anthropic-ratelimit-tokens-limit'),
        retryAfter: response.headers.get('retry-after'),
      },
      bodySnippet: bodyText.slice(0, 500),
    });
  } catch (error) {
    return json(200, {
      ok: false,
      model,
      caughtError: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    });
  }
}

export const config = {
  path: '/api/zz-diag-anthropic',
};
