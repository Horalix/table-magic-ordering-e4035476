import React from 'react';
import { motion } from 'framer-motion';
import { Check, ChefHat, Bell, Utensils, XCircle } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { easeLux } from '@/lib/motion';

const STAGES = [
  { key: 'received', labelKey: 'status_received', icon: Check },
  { key: 'preparing', labelKey: 'status_preparing', icon: ChefHat },
  { key: 'ready', labelKey: 'status_ready', icon: Bell },
  { key: 'served', labelKey: 'status_served', icon: Utensils },
] as const;

const STATUS_INDEX: Record<string, number> = { pending: 0, confirmed: 0, preparing: 1, ready: 2, served: 3 };

/** Horizontal Received → Preparing → Ready → Served progress for an order. */
const OrderStatusTimeline = ({ status }: { status: string }) => {
  const t = useT();

  if (status === 'cancelled') {
    return (
      <div className="flex items-center gap-2 text-destructive text-sm font-sans py-1">
        <XCircle className="w-4 h-4" /> {t('status_cancelled')}
      </div>
    );
  }

  const current = STATUS_INDEX[status] ?? 0;

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
        aria-valuetext={`${STAGES[current]?.key ?? 'pending'} — step ${current + 1} of ${STAGES.length}`}
      >
        {STAGES.map((s, i) => {
          const reached = i <= current;
          const Icon = s.icon;
          return (
            <React.Fragment key={s.key}>
              <motion.div
                initial={false}
                animate={{ scale: i === current ? 1 : 0.92 }}
                transition={{ duration: 0.3, ease: easeLux }}
                className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center border-2 ${reached ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border text-muted-foreground'} ${i === current && status !== 'served' ? 'breathe' : ''}`}
              >
                <Icon className="w-3.5 h-3.5" />
              </motion.div>
              {i < STAGES.length - 1 && (
                <div className="flex-1 h-0.5 mx-1 rounded bg-border overflow-hidden">
                  <motion.div
                    className="h-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: i < current ? '100%' : '0%' }}
                    transition={{ duration: 0.4, ease: easeLux, delay: i * 0.05 }}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5">
        {STAGES.map((s, i) => (
          <span key={s.key} className={`text-[10px] font-sans text-center w-7 ${i === current ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
            {t(s.labelKey)}
          </span>
        ))}
      </div>
    </div>
  );
};

export default OrderStatusTimeline;
