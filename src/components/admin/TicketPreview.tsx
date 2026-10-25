import React from 'react';
import type { TicketLine } from '@/lib/ticket-export';

/**
 * A ticket as the thermal printer will print it: same lines, same grid, the
 * inverse bands black. What the owner sees here is what comes out of every
 * printer — browser, Bluetooth or network — because all of them draw these
 * lines.
 */
const TicketPreview = ({ lines, paperWidth, className = '' }: { lines: TicketLine[]; paperWidth: number; className?: string }) => {
  const cols = paperWidth === 58 ? 32 : 48;
  return (
    <div className={`overflow-x-auto ${className}`}>
      <div
        role="img"
        aria-label={`Ticket preview, ${paperWidth} mm paper`}
        className="mx-auto bg-white text-black rounded-md shadow-lux border border-border/60 px-3 py-4 font-mono"
        style={{ width: `calc(${cols}ch + 1.5rem)`, fontSize: paperWidth === 58 ? 12 : 11, lineHeight: 1.25 }}
      >
        {lines.map((line, i) => {
          const big = line.size === 2;
          const tall = !big && line.tall;
          return (
            <div
              key={i}
              className={`whitespace-pre overflow-hidden ${line.bold ? 'font-bold' : ''} ${line.invert ? 'bg-black text-white' : ''}`}
              style={{
                fontSize: big ? '2em' : undefined,
                height: big ? '1.25em' : tall ? '2.5em' : '1.25em',
              }}
            >
              <span
                className="inline-block"
                style={tall ? { transform: 'scaleY(2)', transformOrigin: 'top left' } : undefined}
              >
                {line.text || ' '}
              </span>
            </div>
          );
        })}
        <div className="mt-3 border-t border-dashed border-black/40" aria-hidden />
      </div>
    </div>
  );
};

export default TicketPreview;
