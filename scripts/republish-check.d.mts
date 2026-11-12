/** Types for scripts/republish-check.mjs, which GitHub runs as plain JavaScript. */
export interface Site { venue: string; name: string; url: string }
export interface Built { ordering: boolean; reservations: boolean; builtAt: number; api: string; key: string }
export interface Now { ordering: boolean; reservations: boolean }
export interface Verdict { action: 'none' | 'wait' | 'publish' | 'stuck'; reason: string; message?: string }

export const SITES: Site[];
export const BUILD_MINUTES: number;
export function readBuilt(site: Site, fetcher?: typeof fetch): Promise<Built | null>;
export function readNow(site: Site, built: Built, fetcher?: typeof fetch): Promise<Now | null>;
export function stateLine(known: { site: Site; now: Now }[]): string;
export function decide(input: {
  sites: { site: Site; built: Built | null; now: Now | null }[];
  head: { time: number; body: string };
  nowMs: number;
  force?: boolean;
}): Verdict;
