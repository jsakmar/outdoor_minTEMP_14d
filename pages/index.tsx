'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Area,
  CartesianGrid, Bar,
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

// ---------- SAFE HELPERS ----------
const safeNumber = (v: any) =>
  typeof v === 'number' && isFinite(v) ? v : 0

// ---------- aggregation ----------
function aggregate15min(data: Row[]): ChartPoint[] {
  const buckets: Record<string, number[]> = {}

  data.forEach((row) => {
    if (row.temperature == null) return

    const d = new Date(row.time)
    d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0)

    const key = d.toISOString()
    if (!buckets[key]) buckets[key] = []
    buckets[key].push(Number(row.temperature))
  })

  return Object.entries(buckets)
    .map(([time, temps]) => {
      if (!temps.length) return null

      const avg = temps.reduce((a, b) => a + b, 0) / temps.length

      return {
        time,
        temperature: safeNumber(avg),
        rain: 0
      }
    })
    .filter(Boolean) as ChartPoint[]
}

// ---------- smoothing ----------
function smooth(data: ChartPoint[]): ChartPoint[] {
  const window = 3

  return data.map((point, i) => {
    const start = Math.max(0, i - window)
    const end = Math.min(data.length - 1, i + window)

    const slice = data.slice(start, end + 1)

    const avg = slice.length
      ? slice.reduce((sum, p) => sum + safeNumber(p.temperature), 0) / slice.length
      : 0

    return {
      ...point,
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

// ---------- tooltip ----------
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null

  const d = new Date(label)

  const time = d.toLocaleTimeString('sk-SK', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  })

  const tempVal = safeNumber(
    payload.find((p: any) => p.dataKey === 'temperature')?.value
  )

  const rainVal = safeNumber(
    payload.find((p: any) => p.dataKey === 'rain')?.value
  )

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: 6,
      padding: '6px 8px'
    }}>
      <div style={{ fontSize: 11, color: '#64748b' }}>{time}</div>
      <div style={{ fontWeight: 600, color: '#22c55e' }}>
        {tempVal.toFixed(1)}°C
      </div>
      <div style={{ fontSize: 11, color: '#0ea5e9' }}>
        ☔ {rainVal.toFixed(2)} mm
      </div>
    </div>
  )
}

// ---------- MAIN ----------
export default function Page() {
  const [data, setData] = useState<ChartPoint[]>([])
  const [range, setRange] = useState(7)

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
        .order('day', { ascending: true })

      if (!mounted) return

      const tempData = smooth(aggregate15min(tempRaw ?? []))

      // rain map safe
      const rainMap: Record<string, number> = {}
      ;(rainRaw as RainRow[] || []).forEach(r => {
        rainMap[r.day] = safeNumber(r.rain_sum)
      })

      // counts
      const counts: Record<string, number> = {}
      tempData.forEach(p => {
        const d = p.time.slice(0, 10)
        counts[d] = (counts[d] || 0) + 1
      })

      // merge safe
      const merged = tempData.map(p => {
        const d = p.time.slice(0, 10)

        const rainVal = counts[d]
          ? rainMap[d] / counts[d]
          : 0

        return {
          time: p.time,
          temperature: safeNumber(p.temperature),
          rain: safeNumber(rainVal)
        }
      })

      setData(merged)
    }

    fetchAll()
    const interval = setInterval(fetchAll, 4 * 60 * 1000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [range])

  const stats = useMemo(() => {
    if (!data.length) return null

    const temps = data.map(d => d.temperature)
    const rainTotal = data.reduce((sum, d) => sum + d.rain, 0)

    return {
      min: Math.min(...temps).toFixed(1),
      max: Math.max(...temps).toFixed(1),
      rain: rainTotal.toFixed(1)
    }
  }, [data])

  const ticks = useMemo(() => generateTicks(data), [data])
  const midnightLines = ticks.filter(t => new Date(t).getHours() === 0)

  return (
    <div style={{ padding: 8 }}>
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
                ↓{stats.min} ↑{stats.max} ☔{stats.rain}
              </div>
            )}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid stroke="#cbd5e1" vertical={false} />

          {midnightLines.map(t => (
            <ReferenceLine key={t} x={t} stroke="#cbd5e1" strokeOpacity={0.6} />
          ))}

          <ReferenceLine y={0} stroke="#000" strokeWidth={1.5} />

          <XAxis dataKey="time" ticks={ticks} interval={0} />
          <YAxis yAxisId="temp" width={30} />
          <YAxis yAxisId="rain" orientation="right" width={30} />

          <Tooltip content={<CustomTooltip />} />

          <Bar yAxisId="rain" dataKey="rain" barSize={6} />
          <Area yAxisId="temp" type="monotone" dataKey="temperature" fill="rgba(59,130,246,0.12)" />
          <Line yAxisId="temp" type="monotone" dataKey="temperature" stroke="#22c55e" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
