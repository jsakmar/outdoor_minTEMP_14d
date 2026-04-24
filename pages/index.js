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
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Row = {
  time: string
  temperature: number
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

// ---------- X tick ----------
const CustomTick = ({ x, y, payload }: any) => {
  const d = new Date(payload.value)

  const isMidnight =
    d.getHours() === 0 && d.getMinutes() === 0

  const show =
    d.getHours() % 4 === 0 || isMidnight

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
        <text y={-10} textAnchor="middle" fill="#64748b" fontSize={11}>
          {date}
        </text>
      )}
      <text y={10} textAnchor="middle" fill="#64748b" fontSize={11}>
        {hour}
      </text>
    </g>
  )
}

// ---------- Y tick ----------
const CustomYTick = ({ y, payload }: any) => (
  <text
    x={6}
    y={y + 3}
    fill="#64748b"
    fontSize={11}
    textAnchor="start"
  >
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

  const value = payload[0].value

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 6,
        padding: '5px 7px',
      }}
    >
      <div style={{ color: '#64748b', fontSize: 11 }}>
        {time}
      </div>
      <div
        style={{
          color: '#22c55e',
          fontWeight: 600,
          fontSize: 12,
        }}
      >
        {value}°C
      </div>
    </div>
  )
}

// ---------- MAIN ----------
export default function Page() {
  const [data, setData] = useState<ChartPoint[]>([])
  const [range, setRange] = useState(7)

  const channelRef = useRef<any>(null)

  useEffect(() => {
    let isMounted = true

    const fetchData = async () => {
      const since = new Date(
        Date.now() - range * 24 * 60 * 60 * 1000
      ).toISOString()

      const { data, error } = await supabase
        .from('netatmo_measurements')
        .select('time, temperature')
        .gte('time', since)
        .eq('module_name', 'Outdoor')
        .not('temperature', 'is', null)
        .order('time', { ascending: true })

      if (!error && isMounted) {
        setData(
          smooth(aggregate15min(data as Row[]))
        )
      }
    }

    fetchData()

    const interval = setInterval(fetchData, 4 * 60 * 1000)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchData()
    }

    window.addEventListener('focus', fetchData)
    document.addEventListener('visibilitychange', handleVisibility)

    if (!channelRef.current) {
      const channel = supabase.channel('realtime-temp')

      channel
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'netatmo_measurements',
          },
          () => fetchData()
        )
        .subscribe()

      channelRef.current = channel
    }

    return () => {
      isMounted = false
      clearInterval(interval)
      window.removeEventListener('focus', fetchData)
      document.removeEventListener('visibilitychange', handleVisibility)

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [range])

  const ticks = useMemo(() => generateTicks(data), [data])

  const midnight = ticks.filter(
    (t) => new Date(t).getHours() === 0
  )
  const every4h = ticks.filter(
    (t) => new Date(t).getHours() % 4 === 0
  )

  return (
    <div style={{ padding: 10 }}>
      {/* RANGE SWITCH */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {[7, 14, 30].map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #e2e8f0',
              background: range === r ? '#22c55e' : '#fff',
              color: range === r ? '#fff' : '#64748b',
              cursor: 'pointer'
            }}
          >
            {r}d
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid stroke="#e2e8f0" />

          {every4h.map((t) => (
            <ReferenceLine key={t} x={t} stroke="#e2e8f0" />
          ))}

          {midnight.map((t) => (
            <ReferenceLine key={t} x={t} stroke="#94a3b8" />
          ))}

          <XAxis
            dataKey="time"
            ticks={ticks}
            interval={0}
            tick={<CustomTick />}
            axisLine={false}
            tickLine={false}
          />

          <YAxis
            tick={<CustomYTick />}
            axisLine={false}
            tickLine={false}
            width={30}
          />

          <ReferenceLine y={0} stroke="#000" strokeOpacity={0.3} />

          <Tooltip content={<CustomTooltip />} />

          <Area
            type="monotone"
            dataKey="temperature"
            fill="rgba(34,197,94,0.15)"
            stroke="none"
          />

          <Line
            type="monotone"
            dataKey="temperature"
            stroke="#22c55e"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
