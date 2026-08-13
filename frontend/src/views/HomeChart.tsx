import { useTranslation } from 'react-i18next'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DailyBucket } from '../shared/bindings'

// Lazy-imported from HomeView.tsx (React.lazy + Suspense) -- recharts
// is the one npm dependency this goal adds (~147KB gzip, docs/goals/
// 0014's own research), kept off Home's default mount path the same
// way elkjs is kept off Composition's default mount path
// (CompositionCanvas.tsx's own dynamic-import precedent, docs/SPEC.md
// §3.3). `ComposedChart` is the batteries-included paired bar+line
// dual-axis shape this goal needs (tooltip/legend/ResponsiveContainer
// built in) -- picking it over a primitives toolkit (visx) or a canvas
// lib (Chart.js/uPlot) is the goal's own decided rationale, not
// reconsidered here.
//
// Every color below is a Primer CSS custom property passed straight
// through as a `fill`/`stroke` value, never a hex literal -- SVG
// presentation attributes resolve `var(--token)` against the live
// cascade, so the chart re-themes on a light/dark toggle with zero
// extra code (the goal's other decided rationale for Recharts: a
// canvas lib would need manual palette re-resolution + redraw on every
// theme switch).
export default function HomeChart({ series }: { series: DailyBucket[] }) {
  const { t } = useTranslation('views')
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--borderColor-muted)" />
        <XAxis dataKey="date" tick={{ fill: 'var(--fgColor-muted)', fontSize: 12 }} />
        <YAxis
          yAxisId="left"
          allowDecimals={false}
          tick={{ fill: 'var(--fgColor-muted)', fontSize: 12 }}
          label={{ value: t('home.chart.runsAxisLabel'), angle: -90, position: 'insideLeft', fill: 'var(--fgColor-muted)', fontSize: 12 }}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          domain={[0, 100]}
          tick={{ fill: 'var(--fgColor-muted)', fontSize: 12 }}
          label={{ value: t('home.chart.errorPercentAxisLabel'), angle: 90, position: 'insideRight', fill: 'var(--fgColor-muted)', fontSize: 12 }}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--bgColor-default)',
            border: '1px solid var(--borderColor-default)',
            borderRadius: 'var(--borderRadius-medium)',
          }}
          labelStyle={{ color: 'var(--fgColor-default)' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {/* Counts stack first, directly above the error-rate line --
            never a bare rate without its own volume right there
            (docs/goals/0014's own explicit rule). */}
        <Bar yAxisId="left" dataKey="success" stackId="runs" name={t('home.chart.succeeded')} fill="var(--fgColor-success)" />
        <Bar yAxisId="left" dataKey="error" stackId="runs" name={t('home.chart.failed')} fill="var(--fgColor-danger)" />
        {/* Deliberately NOT connectNulls: a day below the minimum
            sample size (Go's minBucketRunsForRate) has no RatePercent
            at all, and bridging over it would visually imply a trend
            through data that was suppressed on purpose -- a real gap in
            the line is the honest rendering of "not enough runs to
            trust a rate here," while the bars above it keep showing the
            real (small) counts regardless. */}
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="ratePercent"
          name={t('home.chart.errorRate')}
          stroke="var(--fgColor-attention)"
          dot={{ r: 3 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
