import fs from 'node:fs';

const file = new URL('../index.html', import.meta.url);
let html = fs.readFileSync(file, 'utf8');

const replaceMeta = (name, value) => {
  const pattern = new RegExp(`<meta\\s+name=["']${name}["'][^>]*>`, 'i');
  const tag = `<meta name="${name}" content="${value}">`;
  html = pattern.test(html) ? html.replace(pattern, tag) : html.replace('</title>', `</title>${tag}`);
};

const replaceProperty = (property, value) => {
  const pattern = new RegExp(`<meta\\s+property=["']${property}["'][^>]*>`, 'i');
  const tag = `<meta property="${property}" content="${value}">`;
  html = pattern.test(html) ? html.replace(pattern, tag) : html.replace('</title>', `</title>${tag}`);
};

html = html.replace(/<title>.*?<\/title>/i, '<title>Find State & Local Government Contracts | NAT-CORP</title>');
replaceMeta('description', 'Find state, county, city, school district and university government bids matched to your business. Free contract discovery and opportunity matching from NAT-CORP.');
replaceMeta('robots', 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1');
replaceProperty('og:type', 'website');
replaceProperty('og:site_name', 'National Corporate Contract Exchange');
replaceProperty('og:title', 'Find Government Contracts Matched to Your Business');
replaceProperty('og:description', 'Stop searching hundreds of procurement portals. NAT-CORP brings state and local government contract opportunities together and matches them to your business.');
replaceProperty('og:url', 'https://natcorp.aproposgroupllc.com/');
replaceProperty('og:image', 'https://natcorp.aproposgroupllc.com/headquarters.webp');
replaceProperty('og:image:alt', 'NAT-CORP government contract opportunity matching platform by Apropos Group LLC');
replaceMeta('twitter:card', 'summary_large_image');
replaceMeta('twitter:title', 'Find Government Contracts Matched to Your Business');
replaceMeta('twitter:description', 'Free state and local government contract discovery and business opportunity matching.');
replaceMeta('twitter:image', 'https://natcorp.aproposgroupllc.com/headquarters.webp');

const schema = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://aproposgroupllc.com/#organization',
      name: 'Apropos Group LLC',
      url: 'https://aproposgroupllc.com/'
    },
    {
      '@type': 'WebSite',
      '@id': 'https://natcorp.aproposgroupllc.com/#website',
      name: 'National Corporate Contract Exchange',
      alternateName: 'NAT-CORP',
      url: 'https://natcorp.aproposgroupllc.com/',
      publisher: { '@id': 'https://aproposgroupllc.com/#organization' }
    },
    {
      '@type': 'Service',
      '@id': 'https://natcorp.aproposgroupllc.com/#service',
      name: 'National Corporate Contract Exchange',
      serviceType: 'State and local government contract opportunity discovery and business matching',
      areaServed: { '@type': 'Country', name: 'United States' },
      provider: { '@id': 'https://aproposgroupllc.com/#organization' },
      url: 'https://natcorp.aproposgroupllc.com/'
    }
  ]
};

const schemaTag = `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
const schemaPattern = /<script\s+type=["']application\/ld\+json["']>.*?<\/script>/is;
html = schemaPattern.test(html) ? html.replace(schemaPattern, schemaTag) : html.replace('</head>', `${schemaTag}</head>`);

if (process.env.GOOGLE_SITE_VERIFICATION) {
  replaceMeta('google-site-verification', process.env.GOOGLE_SITE_VERIFICATION);
}

const gaId = process.env.GA4_MEASUREMENT_ID ? process.env.GA4_MEASUREMENT_ID.replace(/[^A-Za-z0-9-]/g, '') : '';
const analytics = gaId ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}',{send_page_view:true});document.addEventListener('click',function(e){const a=e.target.closest('a');if(!a)return;const href=a.getAttribute('href')||'';if(href==='/intake'||href.startsWith('/intake?'))gtag('event','dashboard_start',{event_category:'acquisition',link_url:href,page_path:location.pathname});});</script>` : '';

if (analytics && !html.includes('www.googletagmanager.com/gtag/js')) html = html.replace('</head>', `${analytics}</head>`);
fs.writeFileSync(file, html);

if (analytics) {
  for (const path of [
    'government-contracts/nevada/index.html',
    'government-contracts/california/index.html',
    'government-contracts/arizona/index.html',
    'resources/find-state-local-government-contracts/index.html'
  ]) {
    const target = new URL(`../${path}`, import.meta.url);
    let page = fs.readFileSync(target, 'utf8');
    if (!page.includes('www.googletagmanager.com/gtag/js')) {
      page = page.replace('</head>', `${analytics}</head>`);
      fs.writeFileSync(target, page);
    }
  }
}

console.log('NAT-CORP SEO Phase 1 build transformations applied.');
await import('./seo-validate.mjs');
