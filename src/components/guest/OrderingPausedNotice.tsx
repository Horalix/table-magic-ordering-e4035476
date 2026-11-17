import { useQuery } from '@tanstack/react-query';
import { PauseCircle } from 'lucide-react';
import { getServiceStatus } from '@/lib/guest-api';
import { useT } from '@/lib/i18n';

/**
 * "Ordering is paused" where a seated guest starts, not only in the cart.
 * Before, a guest could fill a whole order and learn at the last step that the
 * kitchen was not taking orders. The same status the cart reads (one cached
 * request, shared under the same key); nothing shows unless it is paused.
 */
const OrderingPausedNotice = () => {
  const t = useT();
  const { data: service } = useQuery({
    queryKey: ['service-status'],
    queryFn: getServiceStatus,
    staleTime: 60_000,
    retry: 1,
  });
  if (service?.ordering_enabled !== false) return null;
  return (
    <div className="flex items-start gap-3 p-3.5 rounded-2xl border border-accent/30 bg-accent/5" role="status">
      <PauseCircle className="w-5 h-5 text-accent shrink-0 mt-px" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-sans font-semibold text-foreground">{t('ordering_paused_title')}</p>
        <p className="text-[13px] font-sans text-muted-foreground mt-0.5">{service.paused_message || t('ordering_paused_body')}</p>
      </div>
    </div>
  );
};

export default OrderingPausedNotice;
