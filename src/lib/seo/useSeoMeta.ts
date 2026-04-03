/**
 * Shkad Aadel — SPA SEO metadata hook.
 * Sets document.title, meta description, og tags, and noindex.
 */

import { useEffect } from 'react';

interface SeoMeta {
  title: string;
  description: string;
  ogType?: string;
  noindex?: boolean;
  canonical?: string;
}

function setMeta(name: string, content: string, property = false) {
  const attr = property ? 'property' : 'name';
  let el = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function removeMetaByName(name: string) {
  const el = document.querySelector(`meta[name="${name}"]`);
  if (el) el.remove();
}

export function useSeoMeta({ title, description, ogType = 'website', noindex = false, canonical }: SeoMeta) {
  useEffect(() => {
    const suffix = 'شكد عادل';
    document.title = title === suffix ? title : `${title} — ${suffix}`;

    setMeta('description', description);
    setMeta('og:title', title, true);
    setMeta('og:description', description, true);
    setMeta('og:type', ogType, true);

    if (noindex) {
      setMeta('robots', 'noindex, nofollow');
    } else {
      removeMetaByName('robots');
    }

    // Canonical
    let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (canonical) {
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        document.head.appendChild(link);
      }
      link.setAttribute('href', canonical);
    } else if (link) {
      link.remove();
    }

    return () => {
      // Cleanup: reset to defaults on unmount
      document.title = 'شكد عادل — ذكاء الأسعار العادلة في العراق';
    };
  }, [title, description, ogType, noindex, canonical]);
}
