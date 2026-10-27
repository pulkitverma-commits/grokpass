import type { MetadataRoute } from 'next';

const BASE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://onepeek.io').replace(/\/$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/s/', '/r/', '/api/', '/dashboard', '/login'] }],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
