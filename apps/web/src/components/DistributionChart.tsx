import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatParameterValue, parameterLabel } from "../lib/parameters";
import type { NumericParameter, ParameterDistribution } from "../lib/types";

interface DistributionChartProps {
  distribution: ParameterDistribution;
  splitBinCount: number | null;
}

export function DistributionChart({ distribution, splitBinCount }: DistributionChartProps) {
  const chartData = distribution.bins.map((bin) => ({
    ...bin,
    shortLabel: bin.range
      ? formatParameterValue(bin.range.minimum, distribution.parameter)
      : "N/A",
  }));

  return (
    <div>
      <div className="h-56 sm:h-64" aria-label={`${parameterLabel(distribution.parameter)} distribution`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 4, bottom: 2, left: -30 }}>
            <CartesianGrid stroke="#29302d" strokeDasharray="2 7" vertical={false} />
            <XAxis
              dataKey="shortLabel"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#849088", fontSize: 10 }}
              dy={8}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#6d7771", fontSize: 10 }}
            />
            <Tooltip
              cursor={{ fill: "rgba(184, 222, 128, 0.05)" }}
              contentStyle={{
                background: "#151a17",
                border: "1px solid #303a34",
                borderRadius: 8,
                color: "#f1f4ef",
                fontSize: 12,
              }}
              labelFormatter={(_, payload) => payload[0]?.payload.label ?? "Range"}
              formatter={(value) => [`${value} tracks`, "Count"]}
            />
            <Bar dataKey="track_count" radius={[4, 4, 1, 1]} maxBarSize={64}>
              {chartData.map((bin) => (
                <Cell
                  key={bin.index}
                  fill={splitBinCount ? "#b8de80" : "#748078"}
                  fillOpacity={0.45 + (bin.track_count / Math.max(...chartData.map((item) => item.track_count), 1)) * 0.5}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-line/80 pt-3 text-xs text-mist/60">
        <span>
          observed {formatParameterValue(distribution.minimum, distribution.parameter)} to{" "}
          {formatParameterValue(distribution.maximum, distribution.parameter)}
        </span>
        <span className="font-mono tabular-nums text-white/75">
          {distribution.unavailable_track_count
            ? `${distribution.unavailable_track_count} missing`
            : `${distribution.bins.reduce((sum, bin) => sum + bin.track_count, 0)} analyzed`}
        </span>
      </div>
    </div>
  );
}

export function DistributionLegend({ parameter }: { parameter: NumericParameter }) {
  return (
    <span className="text-xs text-mist/55">
      Equal-width bins across observed {parameterLabel(parameter).toLowerCase()}
    </span>
  );
}
