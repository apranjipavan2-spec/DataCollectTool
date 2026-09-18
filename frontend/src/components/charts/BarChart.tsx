// Bar chart component

interface BarDatum {
  label: string
  value: number
  color?: string
}

interface BarChartProps {
  data: BarDatum[]
  height?: number
}

const theme = {
  surface: '#1e1e2e',
  border: '#2a2a3e',
  text: '#cdd6f4',
  muted: '#6c7086',
  accent: '#89b4fa',
}

export default function BarChart({ data, height = 220 }: BarChartProps) {
  if (data.length === 0) {
    return (
      <div style={{ color: theme.muted, fontSize: 13, textAlign: 'center', padding: 24 }}>
        No data
      </div>
    )
  }

  const maxVal = Math.max(...data.map(d => d.value), 1)
  const labelWidth = 110
  const rightPad = 40
  const barHeight = 26
  const barGap = 8
  const totalH = Math.max(height, data.length * (barHeight + barGap) + 8)

  return (
    <svg
      width="100%"
      height={totalH}
      viewBox={`0 0 600 ${totalH}`}
      preserveAspectRatio="xMinYMin meet"
      style={{ display: 'block' }}
    >
      {data.map((d, i) => {
        const y = i * (barHeight + barGap) + 4
        const barMaxWidth = 600 - labelWidth - rightPad
        const barW = Math.max(4, (d.value / maxVal) * barMaxWidth)
        const color = d.color ?? theme.accent

        return (
          <g key={i}>
            {/* Label */}
            <text
              x={labelWidth - 8}
              y={y + barHeight / 2 + 1}
              textAnchor="end"
              dominantBaseline="central"
              fill={theme.text}
              fontSize={12}
              fontFamily="system-ui, sans-serif"
            >
              {d.label.length > 14 ? d.label.slice(0, 13) + '\u2026' : d.label}
            </text>

            {/* Bar */}
            <rect
              x={labelWidth}
              y={y}
              width={barW}
              height={barHeight}
              rx={4}
              fill={color}
              opacity={0.8}
            />

            {/* Value label */}
            <text
              x={labelWidth + barW + 6}
              y={y + barHeight / 2 + 1}
              dominantBaseline="central"
              fill={theme.muted}
              fontSize={11}
              fontFamily="system-ui, sans-serif"
            >
              {d.value}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
