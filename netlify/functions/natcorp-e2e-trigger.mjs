const env = (name) => globalThis.Netlify?.env?.get(name) || process.env[name] || '';
export default async (req) => {
  const url = new URL(req.url);
  if (req.method !== 'GET') return new Response('GET required',{status:405});
  if (!env('NATCORP_E2E_NONCE') || url.searchParams.get('nonce') !== env('NATCORP_E2E_NONCE')) return new Response('Unauthorized',{status:401});
  const response = await fetch(`${url.origin}/api/natcorp-daily-operations`, {
    method:'POST',
    headers:{'content-type':'application/json','origin':url.origin,'referer':`${url.origin}/natcorp-command`,'x-natcorp-command-key':env('NATCORP_COMMAND_KEY')},
    body:JSON.stringify({action:'begin'}),
    signal:AbortSignal.timeout(20000),
  });
  return new Response(await response.text(),{status:response.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
};
export const config = { path:'/api/natcorp-e2e-trigger', preferStatic:false };
