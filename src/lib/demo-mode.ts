/**
 * True in the offline demo build (docs/demo-mode.md), false everywhere else.
 *
 * A constant at build time (src/lib/home-venue.ts says how), so the normal
 * build leaves out whatever this guards, every import of src/demo included.
 */
export { DEMO_BUILD as DEMO_MODE } from './home-venue';
