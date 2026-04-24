'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
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
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
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

  data.forEach((row) => {
    const d = new Date(row.time)
    d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0)

    const key = d.toISOString()
    if (!buckets[key]) buckets[key] = []
    buckets[key].push(row.temperature)
  })

  return Object.entries(buckets)
    .map(([time, temps]) => ({
      time,
      temperature:
        temps.reduce((a, b) => a + b, 0) / temps.length,
    }))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
}

// ---------- smoothing ----------
function smooth(data: ChartPoint[]): ChartPoint[] {
  const window = 3

  return data.map((point, i) => {
    const start = Math.max(0, i - window)
    const end = Math.min(data.length - 1, i + window)

    const slice = data.slice(start, end + 1)
    const avg =
      slice.reduce((sum, p) => sum + p.temperature, 0) /
      slice.length

    return {
      time: point.time,
      temperature: Number(avg.toFixed(1)),
    }
  })
}

// ---------- ticks ----------
function generateTicks(data: ChartPoint[]) {
  if (!data.length) return []

  const start = new Date(data[0].time)
  const end = new Date(data[data.length - 1].time)

  const ticks: string[] = []
  const cursor = new Date(start)
  cursor.setMinutes(0, 0, 0)

  while (cursor <= end) {
    ticks.push(cursor.toISOString())
    cursor.setHours(cursor.getHours() + 1)
  }

  return ticks
}

// ---------- custom ticks ----------
const CustomTick = ({ x, y, payload }: any) => {
  const d = new Date(payload.value)

  const isMidnight = d.getHours() === 0
  const show = d.getHours() % 6 === 0 || isMidnight
  if (!show) return null

  const date = d.toLocaleDateString('sk-SK', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
  })

  const hour = d.toLocaleTimeString('sk-SK', {
    timeZone: TZ,
    hour: '2-digit',
  })

  return (
    <g transform={`translate(${x},${y})`}>
      {isMidnight && (
        <text y={-10} textAnchor="middle" fill="#94a3b8" fontSize={10}>
          {date}
        </text>
      )}
      <text y={10} textAnchor="middle" fill="#94a3b8" fontSize={10}>
        {hour}
      </text>
    </g>
  )
}

const CustomYTick = ({ y, payload }: any) => (
  <text x={4} y={y + 3} fill="#94a3b8" fontSize={10}>
    {payload.value}
  </text>
)

// ---------- tooltip ----------
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null

  const d = new Date(label)
  const time = d.toLocaleTimeString('sk-SK', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: 6,
      padding: '6px 8px'
    }}>
      <div style={{ fontSize: 11, color: '#64748b' }}>{time}</div>
      <div style={{ fontWeight: 600, color: '#22c55e' }}>
        {payload[0].value}°C
      </div>
    </div>
  )
}

// ---------- MAIN ----------
export default function Page() {
  const [data, setData] = useState<ChartPoint[]>([])
  const [range, setRange] = useState(7)
  const [isMobile, setIsMobile] = useState(false)

  const channelRef = useRef<any>(null)

  // auto iframe resize
  useEffect(() => {
    const sendHeight = () => {
      const height = document.body.scrollHeight
      window.parent.postMessage({ type: 'resize', height }, '*')
    }
    sendHeight()
    window.addEventListener('resize', sendHeight)
    return () => window.removeEventListener('resize', sendHeight)
  }, [])

  // mobile detect
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // data
  useEffect(() => {
    let mounted = true

    const fetchData = async () => {
      const since = new Date(Date.now() - range * 86400000).toISOString()

      const { data, error } = await supabase
        .from('netatmo_measurements')
        .select('time, temperature, module_name')
        .gte('time', since)
        .eq('module_name', 'Outdoor')
        .not('temperature', 'is', null)
        .order('time', { ascending: true })

      if (!error && mounted) {
        setData(smooth(aggregate15min(data as Row[])))
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 4 * 60 * 1000)

    if (!channelRef.current) {
      channelRef.current = supabase
        .channel('realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'netatmo_measurements' }, fetchData)
        .subscribe()
    }

    return () => {
      mounted = false
      clearInterval(interval)
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [range])

  // stats
  const stats = useMemo(() => {
    if (!data.length) return null
    const temps = data.map(d => d.temperature)
    return {
      min: Math.min(...temps),
      max: Math.max(...temps),
    }
  }, [data])

  const ticks = useMemo(() => generateTicks(data), [data])

  const gridLines = ticks.filter((t) => {
    const h = new Date(t).getHours()

    if (isMobile) {
      if (range === 7) return h === 0 || h === 12
      return h === 0
    }

    if (range === 7) return h % 4 === 0
    if (range === 14) return h % 6 === 0
    return h % 12 === 0
  })

  return (
    <div style={{ padding: 8 }}>
      {/* RANGE */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {[7, 14, 30].map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              background: range === r ? '#22c55e' : '#fff',
              color: range === r ? '#fff' : '#64748b',
              fontSize: 12
            }}
          >
            <div>{r}d</div>
            {stats && range === r && (
              <div style={{ fontSize: 10 }}>
                ↓{stats.min.toFixed(1)} / ↑{stats.max.toFixed(1)}
              </div>
            )}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid stroke="#cbd5e1" strokeOpacity={0.6} vertical={false} />

          {gridLines.map((t) => (
            <ReferenceLine key={t} x={t} stroke="#cbd5e1" />
          ))}

          {/* FREEZING ZONE */}
          <ReferenceLine y={0} stroke="#000" strokeWidth={1.5} />
          <Area
            type="monotone"
            dataKey="temperature"
            fill="rgba(59,130,246,0.12)"
            baseValue={0}
          />

          <XAxis dataKey="time" ticks={ticks} tick={<CustomTick />} axisLine={false} tickLine={false} />
          <YAxis tick={<CustomYTick />} axisLine={false} tickLine={false} width={30} />

          <Tooltip content={<CustomTooltip />} />

          <Line
            type="monotone"
            dataKey="temperature"
            stroke="#22c55e"
            strokeWidth={isMobile ? 3 : 2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
