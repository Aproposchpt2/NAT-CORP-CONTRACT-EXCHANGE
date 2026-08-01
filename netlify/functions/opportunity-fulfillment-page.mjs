export default async function handler(req) {
  const url = new URL(req.url);
  const target = new URL('/opportunity-fulfillment.html', url.origin);
  target.search = url.search;
  return Response.redirect(target.toString(), 302);
}

export const config = { path: '/opportunity-fulfillment' };
