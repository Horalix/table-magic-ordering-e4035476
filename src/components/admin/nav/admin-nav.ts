import {
  BarChart3, Brain, CalendarCheck, CalendarClock, ChefHat, ClipboardList, ConciergeBell, House,
  Layers, LayoutDashboard, LayoutGrid, Monitor, Printer, QrCode, Receipt, ScrollText,
  SlidersHorizontal, Star, TableProperties, Tag, ToggleRight, TrendingUp, UserCog, Users,
  UtensilsCrossed, type LucideIcon,
} from 'lucide-react';

/**
 * The admin's map: five areas, by what the manager is doing, and the pages
 * inside each. One list, read by the sidebar, the tabs at the top of a page,
 * the phone's bottom bar, the More sheet and the search (src/components/admin/nav).
 *
 * No address changes when a page moves between areas: alerts, bookmarks and
 * the docs all link to /admin/…, and admin-nav.test.ts holds this list to the
 * routes in src/App.tsx, each exactly once.
 *
 * `keywords` are what a manager would type into the search when they do not
 * know the page's name ("PIN", "sold out", "wifi printer"). Keep them to
 * things the page really does.
 */

export type AreaId = 'home' | 'service' | 'menu' | 'reports' | 'setup';

export interface NavArea {
  id: AreaId;
  label: string;
  icon: LucideIcon;
}

export interface NavPage {
  /** The page's name: its tab, its entry in the search, the browser tab's title. */
  label: string;
  path: string;
  icon: LucideIcon;
  area: AreaId;
  /** One line under the name in the search and the More sheet. */
  about: string;
  keywords: string[];
  /** The owner's: hidden from, and refused to, a restaurant's own admin. */
  ownerOnly?: boolean;
  /** Left out of the offline demo, which has one restaurant (docs/demo-mode.md). */
  hiddenInDemo?: boolean;
}

/** A screen of its own, opened from the admin: not an admin page, and it has none of the admin around it. */
export interface NavLauncher {
  label: string;
  path: string;
  icon: LucideIcon;
  about: string;
  keywords: string[];
}

export const RESERVATIONS_PATH = '/admin/reservations';

export const AREAS: readonly NavArea[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'service', label: 'Service', icon: ConciergeBell },
  { id: 'menu', label: 'Menu', icon: UtensilsCrossed },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'setup', label: 'Setup', icon: SlidersHorizontal },
];

/** In the order the tabs show them; the first of an area is where the area opens the first time. */
export const PAGES: readonly NavPage[] = [
  // Home
  {
    label: 'Dashboard', path: '/admin', icon: LayoutDashboard, area: 'home',
    about: 'How today is going',
    keywords: ['today', 'home', 'overview', 'revenue', 'sales today', 'active tables', 'bill requests', 'waiter calls', 'things to do', 'recent orders'],
  },
  {
    label: 'Both restaurants', path: '/admin/overview', icon: LayoutGrid, area: 'home', ownerOnly: true, hiddenInDemo: true,
    about: 'La Soul and Vera Italia side by side',
    keywords: ['overview', 'owner', 'compare', 'la soul', 'vera italia', 'both', 'side by side'],
  },

  // Service
  {
    label: 'Orders', path: '/admin/orders', icon: ClipboardList, area: 'service',
    about: 'Find, refund or cancel an order',
    keywords: ['order', 'find order', 'order code', 'refund', 'money back', 'cancel order', 'void', 'payment', 'paid', 'cash', 'card', 'receipt', 'bill', 'held order'],
  },
  {
    label: 'Reservations', path: RESERVATIONS_PATH, icon: CalendarClock, area: 'service',
    about: 'Answer guests asking for a table',
    keywords: ['booking', 'bookings', 'book a table', 'reserve', 'reservation', 'confirm', 'decline', 'waiting', 'alerts', 'alert this phone', 'notifications', 'whatsapp', 'viber', 'guest phone', 'largest group', 'reservation rules'],
  },
  {
    label: 'Tonight’s waiters', path: '/admin/tonight', icon: CalendarCheck, area: 'service',
    about: 'Who has which section this shift',
    keywords: ['tonight', 'shift', 'rota', 'assign', 'who is working', 'section', 'cover', 'waiter tonight', 'today waiters'],
  },

  // Menu
  {
    label: 'Dishes', path: '/admin/menu', icon: UtensilsCrossed, area: 'menu',
    about: 'Prices, photos, sold out',
    keywords: ['menu', 'dish', 'item', 'price', 'change price', 'sold out', 'unavailable', 'out of stock', 'available', 'photo', 'picture', 'image', 'allergens', 'dietary', 'vegan', 'category', 'description', 'translate', 'translation', 'add dish', 'new dish', 'drinks'],
  },
  {
    label: 'Promotions', path: '/admin/promotions', icon: Tag, area: 'menu',
    about: 'Sale prices and combos',
    keywords: ['promotion', 'promo', 'sale', 'discount', 'offer', 'deal', 'combo', 'bundle', 'special', 'happy hour'],
  },
  {
    label: 'Menu intelligence', path: '/admin/menu-intelligence', icon: Brain, area: 'menu',
    about: 'What sells, what is looked at, what to change',
    keywords: ['intelligence', 'insights', 'suggestions', 'recommendations', 'pairings', 'goes together', 'best sellers', 'not selling', 'views', 'looked at', 'margin', 'food cost', 'ingredient cost', 'menu engineering', 'stars', 'what to change'],
  },

  // Reports
  {
    label: 'Daily report', path: '/admin/reports', icon: Receipt, area: 'reports',
    about: 'The day’s takings, and closing the day',
    keywords: ['daily', 'report', 'close the day', 'end of day', 'closing', 'shift close', 'z report', 'takings', 'cash', 'card', 'tips', 'sales by hour', 'export', 'csv', 'yesterday', 'accountant'],
  },
  {
    label: 'Analytics', path: '/admin/analytics', icon: BarChart3, area: 'reports',
    about: 'Sales over days and weeks',
    keywords: ['analytics', 'statistics', 'stats', 'charts', 'trends', 'net sales', 'last week', 'last month', '30 days', 'busiest hour', 'orders by hour', 'most ordered', 'table turnover', 'category sales', 'export'],
  },
  {
    label: 'What the app earned', path: '/admin/impact', icon: TrendingUp, area: 'reports',
    about: 'What ordering from the table brought in',
    keywords: ['impact', 'earned', 'worth it', 'return', 'roi', 'value', 'extra sales', 'upsell', 'suggestions revenue'],
  },
  {
    label: 'Performance', path: '/admin/performance', icon: Star, area: 'reports',
    about: 'Each waiter’s sales, speed and ratings',
    keywords: ['performance', 'staff performance', 'waiter sales', 'ratings', 'stars', 'reviews', 'low ratings', 'speed', 'tips', 'best waiter'],
  },
  {
    label: 'Audit log', path: '/admin/audit', icon: ScrollText, area: 'reports',
    about: 'Who changed what, and when',
    keywords: ['audit', 'log', 'history', 'who changed', 'who did', 'changes', 'refunds', 'voids', 'money', 'price changes', 'security'],
  },

  // Setup
  {
    label: 'Ordering & service', path: '/admin/service', icon: ToggleRight, area: 'setup',
    about: 'Switch ordering on or off; menu only',
    keywords: ['ordering', 'accept orders', 'stop orders', 'pause', 'menu only', 'switch off', 'closed', 'service controls', 'opening hours', 'end of work day', 'fake orders', 'protection', 'suggestions', 'take reservations', 'settings'],
  },
  {
    label: 'Tables', path: '/admin/tables', icon: TableProperties, area: 'setup',
    about: 'Add tables; free one that was left open',
    keywords: ['table', 'tables', 'add table', 'table number', 'generate tables', 'free table', 'close table', 'open tables', 'seats', 'move table'],
  },
  {
    label: 'QR codes', path: '/admin/qr-codes', icon: QrCode, area: 'setup',
    about: 'Print or show a table’s code',
    keywords: ['qr', 'qr code', 'code', 'print codes', 'sticker', 'table card', 'a4 sheet', 'scan', 'download qr'],
  },
  {
    label: 'Floor sections', path: '/admin/sections', icon: Layers, area: 'setup',
    about: 'Group the tables: terrace, inside',
    keywords: ['section', 'sections', 'floor', 'terrace', 'garden', 'inside', 'area', 'zone', 'floor plan', 'assign tables'],
  },
  {
    label: 'Waiters', path: '/admin/waiters', icon: Users, area: 'setup',
    about: 'Sign-ins, passwords and floor PINs',
    keywords: ['waiter', 'waiters', 'staff', 'new waiter', 'add waiter', 'pin', 'floor pin', 'password', 'reset password', 'forgot password', 'username', 'sign-in', 'login', 'kitchen tablet', 'account'],
  },
  {
    label: 'Printing', path: '/admin/printing', icon: Printer, area: 'setup',
    about: 'Kitchen and bar ticket printers',
    keywords: ['print', 'printer', 'printers', 'wifi printer', 'ticket', 'receipt printer', 'kitchen printer', 'bar printer', 'paper', 'not printing', 'print queue', 'epson', 'star', 'station', 'test print'],
  },
  {
    label: 'Team', path: '/admin/team', icon: UserCog, area: 'setup', ownerOnly: true,
    about: 'Who runs each restaurant',
    keywords: ['team', 'admin', 'admins', 'manager', 'managers', 'appoint', 'owner', 'access', 'password', 'reset password', 'remove account', 'who can sign in', 'new manager'],
  },
];

export const LAUNCHERS: readonly NavLauncher[] = [
  {
    label: 'Kitchen display', path: '/kitchen', icon: ChefHat,
    about: 'The kitchen and bar’s order screen',
    keywords: ['kitchen', 'kds', 'bar', 'cook', 'tickets', 'chef', 'kitchen screen'],
  },
  {
    label: 'Floor monitor', path: '/waiter/monitor', icon: Monitor,
    about: 'Every table at a glance',
    keywords: ['floor', 'monitor', 'tables now', 'pass', 'all tables', 'waiter screen', 'floor screen'],
  },
];

export interface NavAudience {
  /** The owner sees the owner's pages. */
  owner: boolean;
  /** The offline demo. */
  demo: boolean;
}

/** The pages this account has in its navigation, in order. */
export function pagesFor({ owner, demo }: NavAudience): NavPage[] {
  return PAGES.filter((p) => (owner || !p.ownerOnly) && !(demo && p.hiddenInDemo));
}

/**
 * The addresses only the owner may open. In the demo, what is left out of the
 * navigation is not guarded either (it never was: the demo is one restaurant
 * and its one account is the owner).
 */
export function ownerPaths(demo: boolean): string[] {
  return PAGES.filter((p) => p.ownerOnly && !(demo && p.hiddenInDemo)).map((p) => p.path);
}

/** The page an address belongs to: the longest path that matches. */
export function pageAt(pathname: string): NavPage | null {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  let best: NavPage | null = null;
  for (const p of PAGES) {
    const match = clean === p.path || (p.path !== '/admin' && clean.startsWith(`${p.path}/`));
    if (match && (!best || p.path.length > best.path.length)) best = p;
  }
  return best;
}

export function areaOf(id: AreaId): NavArea {
  return AREAS.find((a) => a.id === id) ?? AREAS[0];
}

/** One area's pages for this account. */
export function pagesIn(area: AreaId, audience: NavAudience): NavPage[] {
  return pagesFor(audience).filter((p) => p.area === area);
}

/** What the search matches a page or a screen on: its name, its line, its keywords. */
export function searchText(entry: { label: string; about: string; keywords: string[] }): string {
  return [entry.label, entry.about, ...entry.keywords].join(' ').toLowerCase();
}

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * How well an entry answers what was typed, 0 (not at all) to 1.
 *
 * Plain and predictable rather than fuzzy: a manager who types "wifi
 * printer" gets Printing first, not whichever page happens to contain those
 * letters in that order. The name counts most, then a keyword said exactly,
 * then every typed word starting some word of the name or a keyword.
 */
export function searchScore(label: string, keywords: readonly string[], query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const name = label.toLowerCase();
  if (name === q) return 1;
  if (name.startsWith(q)) return 0.95;
  if (words(name).some((w) => w.startsWith(q))) return 0.9;
  if (name.includes(q)) return 0.85;
  const keys = keywords.map((k) => k.toLowerCase());
  if (keys.includes(q)) return 0.8;
  if (keys.some((k) => k.startsWith(q))) return 0.7;
  if (keys.some((k) => words(k).some((w) => w.startsWith(q)) || k.includes(q))) return 0.6;
  // Several words, in any order, each the start of some word here ("printer wifi", "change price").
  const typed = words(q);
  const here = [...words(name), ...keys.flatMap(words)];
  if (typed.length > 1 && typed.every((t) => here.some((w) => w.startsWith(t)))) return 0.4;
  return 0;
}
