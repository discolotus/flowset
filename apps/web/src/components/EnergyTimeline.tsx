import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Track } from "../lib/types";

export function EnergyTimeline({ tracks }: { tracks: Track[] }) {
  const data = tracks.map((track, index) => ({
    position: index + 1,
    energy: track.audio_features?.energy ?? null,
    tempo: track.audio_features?.tempo ?? null,
    name: track.name,
  }));

  return (
    <div className="h-52 w-full" aria-label="Energy timeline">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 8, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id="energyFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#b8f36b" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#b8f36b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#252b2f" strokeDasharray="2 6" vertical={false} />
          <XAxis
            dataKey="position"
            tick={{ fill: "#778079", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tick={{ fill: "#778079", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ stroke: "#b8f36b", strokeDasharray: "3 4" }}
            contentStyle={{
              background: "#171b1e",
              border: "1px solid #30373b",
              borderRadius: 12,
              color: "#f4f6f2",
              fontSize: 12,
            }}
            formatter={(value, name) => [
              typeof value === "number" ? value.toFixed(name === "tempo" ? 0 : 2) : "—",
              name === "energy" ? "Energy" : "BPM",
            ]}
            labelFormatter={(_, payload) => payload[0]?.payload.name ?? "Track"}
          />
          <Area
            type="monotone"
            dataKey="energy"
            stroke="#b8f36b"
            strokeWidth={2.5}
            fill="url(#energyFill)"
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
