// Line chart component

interface LineDatum {
  date: string
  count: number
}

interface LineChartProps {
  data: LineDatum[]
  height?: number
}

const theme = {
  surface: '#1e1e2e',
  border: '#2a2a3e',
  text: '#cdd6f4',
  muted: '#6c7086',
  accent: '#89b4fa',
}

export default function LineChart({ data, height = 220 }: LineChartProps) {
  if (data.length === 0) {
    return (
      <div style={{ color: theme.muted, fontSize: 13, textAlign: 'center', padding: 24 }}>
        No data
      </div>
    )
  }

  const padLeft = 40
  const padRight = 16
  const padTop = 16
  const padBottom = 40
  const w = 600
  const h = height

  const chartW = w - padLeft - padRight
  const chartH = h - padTop - padBottom

  const maxCount = Math.max(...data.map(d => d.count), 1)
  // Round up y-axis max to a nice number
  const yMax = Math.ceil(maxCount * 1.15) || 1

  const xStep = data.length > 1 ? chartW / (data.length - 1) : 0

  const points = data.map((d, i) => ({
    x: padLeft + (data.length > 1 ? i * xStep : chartW / 2),
    y: padTop + chartH - (d.count / yMax) * chartH,
    ...d,
  }))

  const polyline = points.map(p => `${p.x},${p.y}`).join(' ')

  // Y-axis grid lines (4 ticks)
  const yTicks = 4
  const yLines = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = Math.round((yMax / yTicks) * i)
    const y = padTop + chartH - (val / yMax) * chartH
    return { val, y }
  })

  // Show at most ~7 x-axis labels
  const labelEvery = Math.max(1, Math.floor(data.length / 7))

  // Area fill path
  const areaPath = data.length > 1
    ? `M ${points[0].x},${padTop + chartH} ` +
      points.map(p => `L ${p.x},${p.y}`).join(' ') +
      ` L ${points[points.length - 1].x},${padTop + chartH} Z`
    : ''

  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMinYMin meet"
      style={{ display: 'block' }}
    >
      {/* Y-axis grid lines + labels */}
      {yLines.map((tick, i) => (
        <g key={`y${i}`}>
          <line
            x1={padLeft}
            y1={tick.y}
            x2={w - padRight}
            y2={tick.y}
            stroke={theme.border}
            strokeWidth={1}
          />
          <text
            x={padLeft - 6}
            y={tick.y + 1}
            textAnchor="end"
            dominantBaseline="central"
            fill={theme.muted}
            fontSize={10}
            fontFamily="system-ui, sans-serif"
          >
            {tick.val}
          </text>
        </g>
      ))}

      {/* Area fill */}
      {areaPath && (
        <path d={areaPath} fill={theme.accent} opacity={0.1} />
      )}

      {/* Line */}
      {data.length > 1 && (
        <polyline
          points={polyline}
          fill="none"
          stroke={theme.accent}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* Dots */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={3.5}
          fill={theme.accent}
          stroke={theme.surface}
          strokeWidth={2}
        />
      ))}

      {/* X-axis date labels */}
      {points.map((p, i) => {
        if (i % labelEvery !== 0 && i !== data.length - 1) return null
        // Format: "Mar 5" style
        const d = new Date(p.date + 'T00:00:00')
        const label = isNaN(d.getTime())
          ? p.date
          : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        return (
          <text
            key={`x${i}`}
            x={p.x}
            y={padTop + chartH + 18}
            textAnchor="middle"
            fill={theme.muted}
            fontSize={10}
            fontFamily="system-ui, sans-serif"
          >
            {label}
          </text>
        )
      })}
    </svg>
  )
}
