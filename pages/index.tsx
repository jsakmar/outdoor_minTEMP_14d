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
  rain: number | null
}

const TZ = 'Europe/Bratislava'

// ---------- SAFE NUMBER ----------
const safe = (v: any) =>
  typeof v === 'number' && isFinite(v) ? v : 0

// ---------- aggregation ----------
function aggregate15min(data: Row[]): ChartPoint[] {
  const buckets: Record<string, number[]> = {}

  data.forEach((row) => {
    if (row.temperature == null) return

    const d = new Date(row.time)
    if (isNaN(d.getTime())) return

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
        temperature: safe(avg),
        rain: null
      }
    })
    .filter(Boolean) as ChartPoint[]
}

// ---------- smoothing ----------
function smooth(data: ChartPoint[]): ChartPoint[] {
  const w = 3

  return data.map((p, i) => {
    const slice = data.slice(
      Math.max(0, i - w),
      Math.min(data.length, i + w + 1)
    )

    const avg = slice.length
      ? slice.reduce((s, x) => s + safe(x.temperature), 0) / slice.length
      : 0

    return { ...p, temperature: Number(avg.toFixed(1)) }
  })
}

// ---------- ticks ----------
function generateTicks(data: ChartPoint[]) {
  if (!data.length) return []

  const start = new Date(data[0].time)
  const end = new Date(data[data.length - 1].time)

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return []

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
  if (isNaN(d.getTime())) return null

  const time = d.toLocaleTimeString('sk-SK', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  })

  const temp = safe(payload.find((p: any) => p.dataKey === 'temperature')?.value)
  const rain = safe(payload.find((p: any) => p.dataKey === 'rain')?.value)

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: 6 }}>
      <div style={{ fontSize: 11 }}>{time}</div>
      <div style={{ color: '#22c55e' }}>{temp.toFixed(1)}°C</div>
      {rain > 0 && (
        <div style={{ color: '#0ea5e9' }}>☔ {rain.toFixed(2)} mm</div>
      )}
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
      const since = new Date(Date.now() - range * 86400000)
      const sinceISO = since.toISOString()
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

      const rainMap: Record<string, number> = {}
      ;(rainRaw as RainRow[] || []).forEach(r => {
        rainMap[r.day] = safe(r.rain_sum)
      })

      const counts: Record<string, number> = {}
      tempData.forEach(p => {
        const d = p.time.slice(0, 10)
        counts[d] = (counts[d] || 0) + 1
      })

      const merged = tempData.map(p => {
        const d = p.time.slice(0, 10)

        const rainVal = counts[d]
          ? rainMap[d] / counts[d]
          : 0

        return {
          time: p.time,
          temperature: safe(p.temperature),
          rain: rainVal > 0 ? rainVal : null // 👈 hide zero bars
        }
      })

      // 🔒 FINAL HARD GUARD (prevents ALL crashes)
      const safeData = merged.filter(p =>
        p.time &&
        !isNaN(new Date(p.time).getTime()) &&
        isFinite(p.temperature)
      )

      setData(safeData)
    }

    fetchAll()
    const i = setInterval(fetchAll, 4 * 60 * 1000)

    return () => {
      mounted = false
      clearInterval(i)
    }
  }, [range])

  const ticks = useMemo(() => generateTicks(data), [data])

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {[7, 14, 30].map(r => (
          <button key={r} onClick={() => setRange(r)}>{r}d</button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid vertical={false} />

          <XAxis dataKey="time" ticks={ticks} interval={0} />
          <YAxis yAxisId="temp" width={30} />
          <YAxis yAxisId="rain" orientation="right" width={30} />

          <Tooltip content={<CustomTooltip />} />

          <Bar yAxisId="rain" dataKey="rain" barSize={6} />
          <Area yAxisId="temp" dataKey="temperature" />
          <Line yAxisId="temp" dataKey="temperature" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
