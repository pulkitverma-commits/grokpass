import type { MetadataRoute } from 'next';
import { SEO_PAGES } from '@/lib/content/seo';
import { USE_CASES } from '@/lib/content/use-cases';

const BASE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://onepeek.io').replace(/\/$/, '');

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const page = (path: string, priority: number): MetadataRoute.Sitemap[number] =>
    ({ url: `${BASE}${path}`, lastModified: now, changeFrequency: 'weekly', priority });
  return [
    page('/', 1),
    page('/pricing', 0.9),
    page('/secret-chat', 0.9),
    page('/encryption', 0.8),
    page('/use-cases', 0.8),
    page('/playbooks', 0.7),
    page('/integrations', 0.7),
    page('/developers', 0.7),
    page('/refer', 0.5),
    ...SEO_PAGES.map(p => page(`/${p.slug}`, 0.8)),
    ...USE_CASES.map(u => page(`/use-cases/${u.slug}`, 0.7)),
    page('/privacy', 0.3),
    page('/terms', 0.3),
  ];
}
