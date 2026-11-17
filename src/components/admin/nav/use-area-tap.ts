import type React from 'react';
import { useNavigate } from 'react-router-dom';
import type { AreaId, NavAudience } from './admin-nav';
import { areaTarget } from './nav-memory';

/**
 * A tap on an area lands where it should even while the page before it is
 * still arriving.
 *
 * An area's link is drawn for the page on screen: "the area you are in goes
 * to its first page". But a page takes a moment to arrive, and until it does
 * the screen still shows the one before. A manager on Analytics who taps Home
 * and then Reports before the dashboard has appeared was sent to Reports'
 * first page: on screen, Reports was still the area they were in.
 *
 * So the question is asked again at the tap, of the address the admin is
 * already going to (the browser's, which changes at once), and the tap goes
 * there when the answer differs from the link as drawn. A tap that opens a
 * new tab or window is left to the browser.
 */
export function useAreaTap(audience: NavAudience) {
  const navigate = useNavigate();
  return (area: AreaId, drawn: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = areaTarget(area, audience, window.location.pathname);
    if (!target || target === drawn) return;
    event.preventDefault();
    navigate(target);
  };
}
