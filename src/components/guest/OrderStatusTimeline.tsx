import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ChefHat, Bell, Utensils, XCircle } from 'lucide-react';
import { useT, useI18n } from '@/lib/i18n';
import { duration, easeEnter, easeStandard, STAGGER } from '@/lib/motion';

const STAGES = [
  { key: 'received', labelKey: 'status_received', lineKey: 'stage_received_line', icon: Check },
  { key: 'preparing', labelKey: 'status_preparing', lineKey: 'stage_preparing_line', icon: ChefHat },
  { key: 'ready', labelKey: 'status_ready', lineKey: 'stage_ready_line', icon: Bell },
  { key: 'served', labelKey: 'status_served', lineKey: 'stage_served_line', icon: Utensils },
] as const;

const STATUS_INDEX: Record<string, number> = { pending: 0, confirmed: 0, preparing: 1, ready: 2, served: 3 };

/**
 * When the order entered its current stage: the server's timestamp when there
 * is one, else the moment this screen saw the stage change. Null when neither
 * is known — better no "min ago" than a wrong one.
 */
function useStageSince(status: string, changedAt?: string | null): number | null {
  const prev = useRef(status);
  const [observedAt, setObservedAt] = useState<number | null>(null);
  useEffect(() => {
    if (prev.current !== status) {
      prev.current = status;
      setObservedAt(Date.now());
    }
  }, [status]);
  const fromServer = changedAt ? Date.parse(changedAt) : NaN;
  return Number.isFinite(fromServer) ? fromServer : observedAt;
}

/** Re-render once every 30 s while a "min ago" is on screen. */
function useMinuteTick(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [active]);
}

interface Props {
  status: string;
  /** When the order reached its current status (ISO), if the data has it. */
  changedAt?: string | null;
  /** Waiting for the waiter: the kitchen does not have it yet, so no stage line. */
  held?: boolean;
}

/**
 * Horizontal Received → Preparing → Ready → Served progress for an order, with
 * a plain sentence for what is happening now and how long ago it started.
 *
 * The current stage glows three times and then stops (WCAG 2.2.2: nothing
 * moves on its own for more than five seconds); it starts again only when the
 * order moves on.
 */
const OrderStatusTimeline = ({ status, changedAt, held = false }: Props) => {
  const t = useT();
  const { plural } = useI18n();
  const since = useStageSince(status, changedAt);
  const cancelled = status === 'cancelled';
  useMinuteTick(since !== null && !cancelled && status !== 'served');

  if (cancelled) {
    return (
      <div className="flex items-center gap-2 text-destructive text-sm font-sans py-1">
        <XCircle className="w-4 h-4" /> {t('status_cancelled')}
      </div>
    );
  }

  const current = STATUS_INDEX[status] ?? 0;
  const stage = STAGES[current];
  const minutes = since !== null ? Math.max(0, Math.floor((Date.now() - since) / 60_000)) : null;
  const ago = minutes === null ? null : minutes < 1 ? t('just_now') : plural('minutes_ago', minutes);

  return (
    <div>
      {/* A row of icons meant nothing to a screen reader. It is a progress
          indicator, so it says so, and it says where the order has got to. */}
      <div
        className="flex items-center"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={STAGES.length}
        aria-valuenow={current + 1}
        aria-valuetext={t('progress_step', { status: t(stage?.labelKey ?? 'status_pending'), n: current + 1, total: STAGES.length })}
      >
        {STAGES.map((s, i) => {
          const reached = i <= current;
          const Icon = s.icon;
          return (
            <React.Fragment key={s.key}>
              <motion.div
                // Keyed by the stage it is in, so the three glows restart when the order moves on.
                key={i === current ? `current-${status}` : s.key}
                initial={false}
                animate={{ scale: i === current ? 1 : 0.92 }}
                transition={{ duration: duration.base, ease: easeStandard }}
                className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center border-2 ${reached ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border text-muted-foreground'} ${i === current && status !== 'served' ? 'breathe breathe-thrice' : ''}`}
              >
                <Icon className="w-3.5 h-3.5" />
              </motion.div>
              {i < STAGES.length - 1 && (
                <div className="flex-1 h-0.5 mx-1 rounded bg-border overflow-hidden">
                  <motion.div
                    className="h-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: i < current ? '100%' : '0%' }}
                    transition={{ duration: duration.slow, ease: easeEnter, delay: i * STAGGER }}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5">
        {/* Each label one line under its dot: centred, the first and last held to the edges. */}
        {STAGES.map((s, i) => (
          <span
            key={s.key}
            className={`w-7 flex whitespace-nowrap text-[10px] font-sans ${i === 0 ? 'justify-start' : i === STAGES.length - 1 ? 'justify-end' : 'justify-center'} ${i === current ? 'text-primary font-semibold' : 'text-muted-foreground'}`}
          >
            {t(s.labelKey)}
          </span>
        ))}
      </div>
      {/* What is happening right now, in words. */}
      {!held && (
      <p className="mt-3 text-sm font-sans text-foreground" aria-live="polite">
        {t(stage.lineKey)}
        {ago && status !== 'served' && <span className="text-muted-foreground"> · {ago}</span>}
      </p>
      )}
    </div>
  );
};

export default OrderStatusTimeline;
