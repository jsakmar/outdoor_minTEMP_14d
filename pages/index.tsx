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
  Bar,
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

type RainRow = {
  day: string
  rain_sum: number | null
}

type ChartPoint = {
  time: string
  temperature: number
  rain: number
}

const TZ = 'Europe/Bratislava'

// ---------- aggregation ----------
function aggregate15min(data: Row[]): ChartPoint[] {
  const buckets: Record<string, number[]> = {}

  data.forEach((row) => {
    const d = new Date(row.time)
    if (isNaN(d.getTime())) return

    d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0)

    const key = d.toISOString()
    if (!buckets[key]) buckets[key] = []
    buckets[key].push(row.temperature)
  })

  return Object.entries(buckets)
    .map(([time, temps]) => ({
      time,
      temperature: temps.reduce((a, b) => a + b, 0) / temps.length,
      rain: 0
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

    const avg =
      slice.reduce((s, x) => s + x.temperature, 0) / slice.length

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
  const rain = payload.find((p: any) => p.dataKey === 'rain')?.value ?? 0

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: 6,
      padding: '6px 8px'
    }}>
      <div style={{ fontSize: 11, color: '#64748b' }}>{time}</div>
      <div style={{ fontWeight: 600, color: '#22c55e' }}>
        {temp}°C
      </div>
      <div style={{ fontSize: 11, color: '#0ea5e9' }}>
        {rain.toFixed(2)} mm
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
    let mounted = true

    const fetchAll = async () => {
      const sinceDate = new Date(Date.now() - range * 86400000)
      const sinceISO = sinceDate.toISOString()
      const sinceDay = sinceISO.slice(0, 10)

      const { data: tempRaw } = await supabase
        .from('netatmo_measurements')
        .select('time, temperature, module_name')
        .gte('time', sinceISO)
        .eq('module_name', 'Outdoor')
        .not('temperature', 'is', null)
        .order('time', { ascending: true })

      const { data: rainRaw } = await supabase
        .from('netatmo_daily_stats')
        .select('day, rain_sum')
        .gte('day', sinceDay)

      if (!mounted) return

      const tempData = smooth(aggregate15min(tempRaw ?? []))

      const rainMap: Record<string, number> = {}
      ;(rainRaw as RainRow[] || []).forEach(r => {
        rainMap[r.day] = typeof r.rain_sum === 'number' ? r.rain_sum : 0
      })

      const counts: Record<string, number> = {}
      tempData.forEach(p => {
        const d = p.time.slice(0, 10)
        counts[d] = (counts[d] || 0) + 1
      })

      const merged = tempData.map(p => {
        const d = p.time.slice(0, 10)
        const rainVal = counts[d] ? rainMap[d] / counts[d] : 0

        return {
          ...p,
          rain: isFinite(rainVal) ? rainVal : 0
        }
      })

      setData(merged)
    }

    fetchAll()
    const interval = setInterval(fetchAll, 4 * 60 * 1000)

    if (!channelRef.current) {
      channelRef.current = supabase
        .channel('realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'netatmo_measurements' }, fetchAll)
        .subscribe()
    }

    return () => {
      mounted = false
      clearInterval(interval)
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [range])

  const stats = useMemo(() => {
    if (!data.length) return null

    const temps = data.map(d => d.temperature)
    const rainTotal = data.reduce((s, d) => s + d.rain, 0)

    return {
      min: Math.min(...temps).toFixed(1),
      max: Math.max(...temps).toFixed(1),
      rain: rainTotal
    }
  }, [data])

  const ticks = useMemo(() => generateTicks(data), [data])
  const midnightLines = ticks.filter(t => new Date(t).getHours() === 0)

  const isRainy = stats && stats.rain > 0.4

  return (
    <div style={{
      padding: 8,
      height: '100vh',
      overflow: 'hidden',
      boxSizing: 'border-box'
    }}>

      {/* BUTTONS */}
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
              background:
                range === r
                  ? (isRainy ? '#0ea5e9' : '#22c55e')
                  : '#fff',
              color: range === r ? '#fff' : '#64748b',
              fontSize: 12
            }}
          >
            <div>{r}d</div>

            {stats && range === r && (
              <div style={{
                fontSize: 10,
                display: 'flex',
                justifyContent: 'center',
                gap: 6
              }}>
                <span>↓{stats.min}</span>
                <span>↑{stats.max}</span>
                <span>☔{stats.rain.toFixed(1)}mm</span>
              </div>
            )}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data}>
          <CartesianGrid stroke="#cbd5e1" vertical={false} />

          {midnightLines.map(t => (
            <ReferenceLine key={t} x={t} stroke="#cbd5e1" strokeOpacity={0.6} />
          ))}

          <ReferenceLine y={0} stroke="#000" strokeWidth={1.5} />

          <XAxis
            dataKey="time"
            ticks={ticks}
            interval={0}
            tick={({ x, y, payload }) => {
              const d = new Date(payload.value)
              if (isNaN(d.getTime()) || d.getHours() !== 0) return null

              const date = d.toLocaleDateString('sk-SK', {
                timeZone: TZ,
                day: '2-digit',
                month: '2-digit',
              })

              return (
                <g transform={`translate(${x},${y})`}>
                  <text y={10} textAnchor="middle" fontSize={11} fontWeight={600}>
                    {date}
                  </text>
                </g>
              )
            }}
            axisLine={false}
            tickLine={false}
          />

          <YAxis width={30} />

          <Tooltip content={<CustomTooltip />} />

          <Bar dataKey="rain" fill="#38bdf8" barSize={6} />

          <Area type="monotone" dataKey="temperature" fill="rgba(59,130,246,0.12)" />

          <Line type="monotone" dataKey="temperature" stroke="#22c55e" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
