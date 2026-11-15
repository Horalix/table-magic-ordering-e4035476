import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CountUp from './CountUp';
import { money } from './admin-format';

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => reduced.value,
}));

afterEach(() => { reduced.value = false; });

describe('CountUp', () => {
  it('counts up from zero to the figure', async () => {
    render(<CountUp value={1834.5} format={money} />);
    expect(screen.getByText('0.00')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('1,834.50')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('is simply the number under reduced motion', () => {
    reduced.value = true;
    render(<CountUp value={45} />);
    expect(screen.getByText('45')).toBeInTheDocument();
  });

  it('uses tabular figures so the width does not jitter', () => {
    reduced.value = true;
    render(<CountUp value={7} />);
    expect(screen.getByText('7')).toHaveClass('tabular-nums');
  });
});
