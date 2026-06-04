'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  CartesianGrid,
} from 'recharts'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Row = {
  time: string
  temperature: number
  module_name: string
}

type ChartPoint = {
  time: string
  temperature: number
}

const TZ = 'Europe/Bratislava'

// ---------- aggregation ----------
function aggregate15min(data: Row[]): ChartPoint[] {
  const buckets: Record<string, number[]> = {}

  data.forEach(row => {
    const d = new Date(row.time)
    if (isNaN(d.getTime())) return

    d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0)
    const key = d.toISOString()

    if (!buckets[key]) {
      buckets[key] = []
    }
    buckets[key].push(row.temperature)
  })

  return Object.entries(buckets)
    .map(([time, temps]) => ({
      time,
      temperature: temps.reduce((a, b) => a + b, 0) / temps.length,
    }))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
}

// ---------- smoothing ----------
function smooth(data: ChartPoint[]): ChartPoint[] {
  const w = 3

  return data.map((p, i) => {
    const slice = data.slice(
      Math.max(0, i - w),
      Math.min(data.length, i + w + 1)
    )

    const avg = slice.reduce((s, x) => s + x.temperature, 0) / slice.length

    return {
      ...p,
      temperature: Number(avg.toFixed(1))
    }
  })
}

// ---------- ticks ----------
function generateTicks(data: ChartPoint[]) {
  if (!data.length) return []

  const start = new Date(data[0].time)
  const end = new Date(data[data.length - 1].time)
  const ticks: string[] = []
  const c = new Date(start)

  c.setMinutes(0, 0, 0)

  while (c <= end) {
    ticks.push(c.toISOString())
    c.setHours(c.getHours() + 1)
  }

  return ticks
}

// ---------- timezone-safe hour ----------
function getHourInTZ(dateStr: string) {
  return Number(
    new Date(dateStr).toLocaleString('en-GB', {
      hour: '2-digit',
      hour12: false,
      timeZone: TZ
    })
  )
}

// ---------- tooltip ----------
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null

  const d = new Date(label)
  const time = d.toLocaleTimeString('sk-SK', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  })

  const temp = payload.find((p: any) => p.dataKey === 'temperature')?.value

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 6,
        padding: '4px 6px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
      }}
    >
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>{time}</div>
      <div style={{ fontWeight: 700, fontSize: 13, color: '#22c55e' }}>
        {temp}°C
      </div>
    </div>
  )
}

// ---------- MAIN ----------
export default function Page() {
  const [data, setData] = useState<ChartPoint[]>([])
  const [range, setRange] = useState(7)
  const [loading, setLoading] = useState(true)

  const fetchAll = async () => {
    const sinceDate = new Date(Date.now() - range * 86400000)
    const sinceISO = sinceDate.toISOString()

    const { data: tempRaw } = await supabase
      .from('netatmo_measurements')
      .select('time, temperature, module_name')
      .gte('time', sinceISO)
      .eq('module_name', 'Outdoor')
      .not('temperature', 'is', null)
      .order('time', { ascending: true })

    const processedData = smooth(aggregate15min(tempRaw ?? []))
    setData(processedData)
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 4 * 60 * 1000)
    return () => clearInterval(interval)
  }, [range])

  // Dynamic frame resizing dispatch system
  useEffect(() => {
    if (!loading) {
      const sendHeight = () => {
        setTimeout(() => {
          const height = document.body.scrollHeight || document.documentElement.scrollHeight
          window.parent.postMessage({ type: 'resize', height }, '*')
        }, 150)
      }
      sendHeight()
      window.addEventListener('resize', sendHeight)
      return () => window.removeEventListener('resize', sendHeight)
    }
  }, [loading, data])

  const stats = useMemo(() => {
    if (!data.length) return null
    const temps = data.map(d => d.temperature)
    return {
      min: Math.min(...temps).toFixed(1),
      max: Math.max(...temps).toFixed(1),
    }
  }, [data])

  const ticks = useMemo(() => generateTicks(data), [data])
  const midnightLines = ticks.filter(t => getHourInTZ(t) === 0)

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '220px', fontFamily: 'system-ui', color: '#64748b' }}>
        Loading temperature data...
      </div>
    )
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', background: '#fff', padding: 0, margin: 0, boxSizing: 'border-box', overflow: 'hidden', height: 'auto' }}>
      <div style={{ width: '100%', maxWidth: '100%', background: '#fff', padding: '2px 4px 4px 0px', boxSizing: 'border-box', overflow: 'hidden', height: 'auto' }}>
        
        {/* Buttons and Stats Panel Header */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 4, padding: '0 2px' }}>
          {[7, 14, 30].map(r => (
            <button
              key={r}
              onClick={() => {
                setLoading(true)
                setRange(r)
              }}
              style={{
                flex: 1,
                padding: '4px 0',
                borderRadius: 6,
                border: '1px solid #e2e8f0',
                background: range === r ? '#22c55e' : '#f8fafc',
                color: range === r ? '#fff' : '#64748b',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <div>{r}d</div>
              {stats && range === r && (
                <div style={{ fontSize: 10, fontWeight: 500, marginTop: 1, opacity: 0.95 }}>
                  ↓{stats.min}°C ↑{stats.max}°C
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Chart Viewport Canvas Box */}
        <div style={{ height: 185, width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              
              {midnightLines.map(t => (
                <ReferenceLine key={t} x={t} stroke="#cbd5e1" strokeWidth={1} />
              ))}
              
              <ReferenceLine y={0} stroke="#475569" strokeWidth={1.2} />

              <YAxis
                axisLine={false}
                tickLine={false}
                width={30}
                tick={{ fill: '#000', fontSize: 10, fontWeight: 500 }}
                domain={['auto', 'auto']}
              />

              <XAxis
                dataKey="time"
                ticks={ticks}
                interval={0}
                axisLine={false}
                tickLine={false}
                tick={({ x, y, payload }) => {
                  if (getHourInTZ(payload.value) !== 0) return null
                  const d = new Date(payload.value)
                  return (
                    <g transform={`translate(${x},${y})`}>
                      <text y={12} textAnchor="middle" fill="#000" fontSize={10} fontWeight={500}>
                        {d.toLocaleDateString('sk-SK', { day: '2-digit', month: '2-digit' })}
                      </text>
                    </g>
                  )
                }}
              />

              <Tooltip content={<CustomTooltip />} shared={true} />

              <Area
                type="monotone"
                dataKey="temperature"
                fill="rgba(34,197,94,0.06)"
                stroke="none"
              />

              <Line
                type="monotone"
                dataKey="temperature"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

      </div>
    </main>
  )
}
