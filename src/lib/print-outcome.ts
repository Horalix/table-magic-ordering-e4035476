/**
 * What a print attempt is allowed to claim.
 *
 * The old code returned `void` from every print path, so paper-out, cover-open
 * and "the printer is off" all looked exactly like success — which is why the
 * failure UI behind them had never once been reached.
 *
 * The distinction that matters is not ok/failed. It is between the two kinds of
 * success:
 *
 *   verified   — the printer was asked and said it printed.
 *   unverified — bytes were written at something that cannot be asked.
 *
 * Most cheap Bluetooth ESC/POS printers, and every browser print dialog, are
 * the second kind. Reporting that as plain "printed" is a lie of exactly the
 * sort that makes a kitchen stop checking the printer. So the UI says
 * `Printing · Star58 (unverified)` and the database records which it was.
 */
/**
 * Both members carry both keys (one always `undefined`) because this project
 * compiles with `strictNullChecks: false`, under which TypeScript will not
 * narrow a boolean discriminant. Without the extra keys every `outcome.reason`
 * in a correctly-guarded branch is a compile error.
 */
export type PrintOutcome =
  | { ok: true; verified: boolean; reason?: undefined }
  | { ok: false; reason: string; verified?: undefined };

/** Human-facing printer state, as reported by a DLE EOT status query. */
export interface PrinterStatus {
  online: boolean;
  coverOpen: boolean;
  paperOut: boolean;
  paperLow: boolean;
  /** False when the device cannot be queried — which is not a claim either way. */
  known: boolean;
}

export const UNKNOWN_STATUS: PrinterStatus = {
  online: true, coverOpen: false, paperOut: false, paperLow: false, known: false,
};

/** The first thing actually wrong, in the order a human would act on it. */
export function describeStatus(status: PrinterStatus): string | null {
  if (!status.known) return null;
  if (!status.online) return 'The printer is offline';
  if (status.coverOpen) return 'The printer cover is open';
  if (status.paperOut) return 'The printer is out of paper';
  return null;
}
