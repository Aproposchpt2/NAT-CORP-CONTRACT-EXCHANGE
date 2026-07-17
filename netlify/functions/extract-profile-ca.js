'use strict';
// CalGCC — Extract a structured business profile from an uploaded capability
// statement (PDF), via Claude's native document understanding.
// POST { filename, dataBase64 } → { ok, profile }

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (c, o) => ({ statusCode: c, headers: CORS, body: JSON.stringify(o) });

// Netlify's synchronous function payload cap is ~6MB; keep decoded PDF well under it.
const MAX_BASE64_LEN = 7_000_000;

const SCHEMA_PROMPT = `Extract a structured business profile from this capability statement for matching against California government solicitations. Respond in this exact JSON format (use null for anything not present in the document — do not guess or invent values):
{
  "company_name": "<string>",
  "poc_name": "<string|null>",
  "poc_title": "<string|null>",
  "poc_phone": "<string|null>",
  "poc_email": "<string|null>",
  "website": "<string|null>",
  "address": { "street": "<string|null>", "city": "<string|null>", "state": "<string|null>", "zip": "<string|null>" },
  "cage_code": "<string|null>",
  "duns_number": "<string|null>",
  "uei_number": "<string|null>",
  "naics_codes": ["<code: description>", ...],
  "certifications": [{ "type": "<e.g. MBE, DVBE, SB>", "certifying_body": "<string|null>", "year": <number|null> }],
  "socio_economic_status": "<string|null>",
  "core_competencies": ["<short phrase>", ...],
  "past_performance": [{ "project": "<string>", "client_type": "<string|null>", "role": "<string|null>", "value": "<string|null>", "outcome": "<string|null>" }],
  "keywords": ["<5-12 short human-readable phrases (1-3 words each, lowercase) describing services offered, suitable for matching against government bid titles>"]
}

Notes:
- "keywords" is the most important field — derive it from core_competencies and the narrative description, not from NAICS codes. It will be matched directly against solicitation titles, so favor concrete service terms (e.g. "MEP engineering", "commissioning", "energy management") over generic business jargon.
- Do not attempt to map NAICS codes to UNSPSC or any state commodity-code system — that crosswalk is unreliable and out of scope here.
- Respond with ONLY the JSON object, no other text.`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return j(405, { error: 'POST only' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
  if (!ANTHROPIC_KEY) return j(500, { error: 'AI service not configured.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'Invalid JSON' }); }

  const { filename = 'document.pdf', dataBase64 = '' } = body;
  if (!dataBase64) return j(400, { error: 'No document provided.' });
  if (dataBase64.length > MAX_BASE64_LEN) return j(400, { error: 'Document too large. Please upload a PDF under 5MB.' });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dataBase64 } },
            { type: 'text', text: SCHEMA_PROMPT },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return j(502, { error: 'AI service error: ' + res.status, detail: err.slice(0, 300) });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return j(500, { error: 'Could not parse the document.', raw: text.slice(0, 300) });

    const profile = JSON.parse(match[0]);
    if (!profile.company_name) return j(422, { error: 'Could not identify a business name in this document. Please upload a capability statement or company profile.' });

    return j(200, { ok: true, profile, source_filename: filename });
  } catch (e) {
    return j(500, { error: e.message });
  }
};
