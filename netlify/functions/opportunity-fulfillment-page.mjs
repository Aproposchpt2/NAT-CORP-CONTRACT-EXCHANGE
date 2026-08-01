const inject = `
<style>
.otf-page-nav{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0 12px}.otf-page-nav .page-label{font-size:11px;color:#65758b;font-weight:700}.otf-page-nav button{border:1px solid #d8e0eb;border-radius:8px;padding:9px 12px;background:#fff;color:#24354e;font-weight:800;cursor:pointer}.otf-page-nav button:disabled{opacity:.45;cursor:not-allowed}.otf-page-nav button.primary{background:#0f2a6a;color:#fff;border-color:#0f2a6a}
</style>
<script>
(() => {
  let queuePage = 1;
  let queueMeta = null;
  const originalFetch = window.fetch.bind(window);
  const inputUrl = (input) => String(typeof input === 'string' ? input : input?.url || '');
  const isQueueUrl = (input) => inputUrl(input).includes('/api/opportunity-queue');
  const isOtfActionUrl = (input) => inputUrl(input).includes('/api/opportunity-fulfillment');
  const parseJsonBody = (init) => {
    if (!init?.body || typeof init.body !== 'string') return null;
    try { return JSON.parse(init.body); } catch { return null; }
  };
  const updatePager = () => {
    const prev = document.getElementById('queuePrev60');
    const next = document.getElementById('queueNext60');
    const label = document.getElementById('queuePageLabel');
    if (!prev || !next || !label) return;
    prev.disabled = !queueMeta?.has_previous;
    next.disabled = !queueMeta?.has_next;
    label.textContent = queueMeta
      ? \`Showing \${queueMeta.range_start || 0}-\${queueMeta.range_end || 0} of \${queueMeta.total || 0} · Batch \${queueMeta.page || 1} of \${queueMeta.total_pages || 1}\`
      : 'Batch 1';
  };

  window.fetch = async (input, init) => {
    if (isQueueUrl(input)) {
      const raw = typeof input === 'string' ? input : input.url;
      const url = new URL(raw, location.origin);
      url.searchParams.set('page', String(queuePage));
      url.searchParams.set('page_size', '60');
      let lastError;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const response = await originalFetch(url.toString(), init);
          const clone = response.clone();
          clone.json().then((data) => {
            if (data?.queue) {
              queueMeta = data.queue;
              queuePage = Number(data.queue.page || queuePage);
              setTimeout(updatePager, 0);
            }
          }).catch(() => {});
          return response;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 700));
        }
      }
      throw lastError;
    }

    if (isOtfActionUrl(input)) {
      const body = parseJsonBody(init);
      const response = await originalFetch(input, init);
      if (body?.action === 'record_response' && String(body?.response_class || '').toUpperCase() === 'INTERESTED' && response.ok) {
        const handoffResponse = await originalFetch('/api/owner-analyze-fit-handoff', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
          body: JSON.stringify({ outreach_id: body.outreach_id }),
        });
        const handoffData = await handoffResponse.json().catch(() => ({}));
        if (!handoffResponse.ok || !handoffData.ok) {
          return new Response(JSON.stringify({
            ok: false,
            error: handoffData.error || 'Interested response was recorded, but the owner Analyze Fit email could not be created.',
          }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
        }
      }
      return response;
    }

    return originalFetch(input, init);
  };

  const install = () => {
    const refresh = document.getElementById('reloadQueue');
    if (!refresh || document.getElementById('otfQueuePager')) return;
    const nav = document.createElement('div');
    nav.id = 'otfQueuePager';
    nav.className = 'otf-page-nav';
    nav.innerHTML = '<button id="queuePrev60" type="button" disabled>Previous 60</button><button id="queueNext60" type="button" class="primary" disabled>Next 60</button><span id="queuePageLabel" class="page-label">Batch 1</span>';
    refresh.parentElement.insertAdjacentElement('afterend', nav);
    document.getElementById('queuePrev60').addEventListener('click', async () => {
      if (!queueMeta?.has_previous) return;
      queuePage = Math.max(1, queuePage - 1);
      await window.loadQueue?.();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.getElementById('queueNext60').addEventListener('click', async () => {
      if (!queueMeta?.has_next) return;
      queuePage += 1;
      await window.loadQueue?.();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    ['queueMode','queueState','excludeProcessed','excludeEnrichment','excludeOutreach'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => { queuePage = 1; queueMeta = null; updatePager(); }, true);
    });
    document.getElementById('reloadQueue')?.addEventListener('click', () => { queuePage = 1; queueMeta = null; }, true);
    updatePager();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
</script>
`;

export default async function handler(req) {
  const url = new URL(req.url);
  const source = `${url.origin}/opportunity-fulfillment.html`;
  const response = await fetch(source, { headers: { accept: 'text/html' }, cache: 'no-store' });
  if (!response.ok) return new Response('Opportunity-to-Fulfillment interface unavailable.', { status: 502 });
  let html = await response.text();
  html = html.replace('</body>', `${inject}</body>`);
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
  });
}

export const config = { path: '/opportunity-fulfillment' };
