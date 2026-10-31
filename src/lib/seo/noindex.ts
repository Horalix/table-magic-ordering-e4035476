import { useEffect } from 'react';

/**
 * Keeps a page out of search results: "not found", and every staff screen.
 *
 * Netlify answers an address the build wrote no page for with the home
 * page's HTML (public/_redirects), so until the app said otherwise such a
 * page was "index, follow" with the home page as its canonical — a sign-in
 * screen or a mistyped link, offered to Google as the restaurant's home. The
 * canonical and the language alternates go (noindex and a canonical that
 * points elsewhere contradict each other); the robots tag is put back as it
 * was when the page closes, and the next page sets its own address
 * (usePageMeta, ./page-meta.ts).
 *
 * A module of its own, not page-meta's: the staff screens call it, and
 * page-meta brings the website's copy and structured data with it.
 */
export function useNoIndex() {
  useEffect(() => {
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previous = robots?.getAttribute('content') ?? null;
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = 'noindex, nofollow';
    document.head.querySelectorAll('link[rel="canonical"], link[rel="alternate"][hreflang]').forEach((el) => el.remove());
    return () => {
      const current = document.head.querySelector('meta[name="robots"]');
      if (previous === null) current?.remove();
      else current?.setAttribute('content', previous);
    };
  }, []);
}
