import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  barProps, CHART, CHART_HEIGHT, chartMargin, cursorProps, gridProps, useChartMotion, xAxisProps, yAxisProps,
} from '@/components/admin/chart-style';

/**
 * A single-series column chart in the shared admin style (chart-style.ts):
 * sales by day, sales by hour, orders by hour.
 *
 * One colour for the series; the one bar the chart is about (`highlight`, e.g.
 * the busiest hour) takes the accent and carries its value on its cap. Every
 * bar has a tooltip, and the figures are also in a table for screen readers.
 */

export interface BarDatum {
  label: string;
  value: number;
  /** A fuller label for the tooltip and the table ("Sat 14 Nov"). */
  long?: string;
}

interface Props {
  data: BarDatum[];
  /** What the value is, for the tooltip: "net sales", "orders". */
  name: string;
  format: (n: number) => string;
  axisFormat?: (n: number) => string;
  highlight?: number;
  height?: number;
  allowDecimals?: boolean;
  /** One sentence for assistive tech: what the chart shows. */
  summary: string;
}

const Tip = ({ active, payload, name, format }: {
  active?: boolean;
  payload?: { payload: BarDatum & { fill: string } }[];
  name: string;
  format: (n: number) => string;
}) => {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-border/80 bg-popover px-3 py-2 shadow-lux-lg">
      <p className="text-[11px] font-sans text-muted-foreground">{row.long ?? row.label}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-sm font-sans font-semibold text-foreground tabular-nums">
        <span className="h-2 w-2 rounded-full" style={{ background: row.fill }} aria-hidden />
        {format(row.value)}
        <span className="text-xs font-normal text-muted-foreground">{name}</span>
      </p>
    </div>
  );
};

const AdminBarChart = ({
  data, name, format, axisFormat, highlight = -1, height = CHART_HEIGHT, allowDecimals = true, summary,
}: Props) => {
  const motion = useChartMotion();
  const rows = data.map((d, i) => ({ ...d, fill: i === highlight ? CHART.highlight : CHART.series }));

  return (
    <figure className="m-0">
      <div role="img" aria-label={summary} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={chartMargin} barCategoryGap="22%">
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...xAxisProps} />
            <YAxis {...yAxisProps} tickFormatter={axisFormat} allowDecimals={allowDecimals} tickCount={4} />
            <Tooltip
              cursor={cursorProps}
              content={<Tip name={name} format={format} />}
              isAnimationActive={false}
            />
            <Bar dataKey="value" {...barProps} {...motion}>
              {rows.map((r) => <Cell key={r.label} fill={r.fill} />)}
              {highlight >= 0 && (
                <LabelList
                  dataKey="value"
                  content={(p) => {
                    if (p.index !== highlight) return null;
                    const x = Number(p.x) + Number(p.width) / 2;
                    return (
                      <text
                        x={x} y={Number(p.y) - 7} textAnchor="middle"
                        fontSize={11} fontWeight={600} fill="hsl(var(--foreground))"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {format(Number(p.value))}
                      </text>
                    );
                  }}
                />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{summary}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}><th scope="row">{d.long ?? d.label}</th><td>{format(d.value)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
};

export default AdminBarChart;
