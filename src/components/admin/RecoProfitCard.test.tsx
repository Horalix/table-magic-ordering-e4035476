import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { supabase } from '@/integrations/supabase/client';
import RecoProfitCard from './RecoProfitCard';

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
afterEach(() => { rpc.mockReset(); });

describe('RecoProfitCard', () => {
  it('renders nothing at all on a database without its migration — not even while loading', async () => {
    let answer: (v: unknown) => void = () => undefined;
    rpc.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const { container } = render(<RecoProfitCard days={30} />);
    expect(container).toBeEmptyDOMElement();
    answer({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.reco_profit_check(_days) in the schema cache' } });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('reco_profit_check', { _days: 30 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps a calm error line for any other failure', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Only staff can read what suggestions earned' } });
    render(<RecoProfitCard days={30} />);
    expect(await screen.findByText(/Could not load the check: Only staff/)).toBeInTheDocument();
  });

  it('shows the check once the database answers', async () => {
    rpc.mockResolvedValueOnce({ data: { status: 'not_running', days: 30, auto_holdout_pct: 10, attach: [] }, error: null });
    render(<RecoProfitCard days={30} />);
    expect(await screen.findByText('Are suggestions earning?')).toBeInTheDocument();
    expect(screen.getByTestId('reco-profit-headline')).toHaveTextContent('Not measured yet');
  });
});
