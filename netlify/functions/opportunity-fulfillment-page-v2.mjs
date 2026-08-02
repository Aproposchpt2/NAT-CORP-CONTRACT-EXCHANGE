const injected = `
<style>
/* OTF operator simplification: retain workflow controls, remove duplicate monitors. */
.queue-controls .queue-check{display:none!important}
.hero{grid-template-columns:1fr!important}
.hero>div.panel:nth-child(2){display:none!important}
#taskStatus,#workflow{display:none!important}
.otf-batch-nav{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 12px}
.otf-batch-nav button{border:1px solid #d8e0eb;border-radius:8px;padding:10px 13px;background:#eef2f7;color:#24354e;font-weight:800;cursor:pointer}
.otf-batch-nav button.primary{background:#0f2a6a;color:#fff;border-color:#0f2a6a}
.otf-batch-nav button:disabled{opacity:.45;cursor:not-allowed}
.otf-batch-label{font-size:11px;color:#65758b;font-weight:700}
@media(max-width:650px){.otf-batch-nav button{width:100%}.otf-batch-label{width:100%;text-align:center}}
</style>
<script>
(() => {
  let queuePage = 1;
  let queueMeta = null;
  const originalFetch = window.fetch.bind(window);
  const inputUrl = (input) => String(typeof input === 'string' ? input : input?.url || '');
  const isQueueRequest = (input) => inputUrl(input).includes('/api/opportunity-queue');

  window.fetch = async (input, init) => {
    if (!isQueueRequest(input)) return originalFetch(input, init);
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw, location.origin);
    url.searchParams.delete('exclude_processed');
    url.searchParams.delete('exclude_enrichment');
    url.searchParams.delete('exclude_outreach');
    url.searchParams.set('page', String(queuePage));
    url.searchParams.set('page_size', '30');
    const response = await originalFetch(url.toString(), init);
    const clone = response.clone();
    clone.json().then((data) => {
      if (data?.queue) {
        queueMeta = data.queue;
        queuePage = Number(data.queue.page || queuePage);
        setTimeout(updateBatchControls, 0);
      }
    }).catch(() => {});
    return response;
  };

  function updateBatchControls() {
    const prev = document.getElementById('otfPreviousBatch');
    const next = document.getElementById('otfNextBatch');
    const label = document.getElementById('otfBatchLabel');
    const meta = document.getElementById('queueMeta');
    if (!prev || !next || !label) return;
    prev.disabled = !queueMeta?.has_previous;
    next.disabled = !queueMeta?.has_next;
    label.textContent = queueMeta
      ? 'Showing ' + (queueMeta.range_start || 0) + '–' + (queueMeta.range_end || 0) + ' of ' + (queueMeta.total || 0) + ' · Batch ' + (queueMeta.page || 1) + ' of ' + (queueMeta.total_pages || 1)
      : 'Batch 1';
    if (meta && queueMeta) meta.textContent = label.textContent;
  }

  function resetToFirstBatch() {
    queuePage = 1;
    queueMeta = null;
    updateBatchControls();
  }

  function install() {
    ['excludeProcessed','excludeEnrichment','excludeOutreach'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });

    const queueControls = document.querySelector('.queue-controls');
    if (queueControls) queueControls.style.gridTemplateColumns = 'minmax(220px,1fr) minmax(160px,.7fr) auto';

    const meta = document.getElementById('queueMeta');
    if (meta && !document.getElementById('otfBatchNav')) {
      const nav = document.createElement('div');
      nav.id = 'otfBatchNav';
      nav.className = 'otf-batch-nav';
      nav.innerHTML = '<button id="otfPreviousBatch" type="button" disabled>Previous Batch</button><button id="otfNextBatch" type="button" class="primary" disabled>Choose Next Batch</button><span id="otfBatchLabel" class="otf-batch-label">Batch 1</span>';
      meta.insertAdjacentElement('afterend', nav);
      document.getElementById('otfPreviousBatch').addEventListener('click', async () => {
        if (!queueMeta?.has_previous || typeof window.loadQueue !== 'function') return;
        queuePage = Math.max(1, queuePage - 1);
        await window.loadQueue();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      document.getElementById('otfNextBatch').addEventListener('click', async () => {
        if (!queueMeta?.has_next || typeof window.loadQueue !== 'function') return;
        queuePage += 1;
        await window.loadQueue();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    ['queueMode','queueState'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', resetToFirstBatch, true);
    });
    document.getElementById('reloadQueue')?.addEventListener('click', resetToFirstBatch, true);

    const poll = setInterval(() => {
      if (typeof window.loadQueue === 'function') {
        clearInterval(poll);
        const originalLoadQueue = window.loadQueue;
        window.loadQueue = async function(...args) {
          const result = await originalLoadQueue.apply(this, args);
          updateBatchControls();
          return result;
        };
        if (window.authenticated) window.loadQueue();
      }
    }, 50);
    setTimeout(() => clearInterval(poll), 5000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
</script>
`;

export default async function handler(req) {
  try {
    const base = process.env.DEPLOY_PRIME_URL || process.env.URL || new URL(req.url).origin;
    const source = new URL('/opportunity-fulfillment.html', base).toString();
    const response = await fetch(source, { headers: { accept: 'text/html' }, cache: 'no-store' });
    if (!response.ok) {
      return new Response('Opportunity-to-Fulfillment interface unavailable.', { status: 502 });
    }
    let html = await response.text();
    html = html.replace('</head>', injected + '</head>');
    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
      },
    });
  } catch (error) {
    console.error('[opportunity-fulfillment-page-v2]', error);
    return new Response('Opportunity-to-Fulfillment interface unavailable.', { status: 500 });
  }
}

export const config = { path: '/opportunity-fulfillment' };
