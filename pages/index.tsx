'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Area, CartesianGrid, Bar
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
  time: number   // 👈 IMPORTANT: use timestamp (not string)
  temperature: number
  rain: number | null
}

const TZ = 'Europe/Bratislava'

// ---------- SAFE ----------
const safe = (v: any) =>
  typeof v === 'number' && isFinite(v) ? v : 0

// ---------- aggregation ----------
function aggregate15min(data: Row[]): ChartPoint[] {
  const buckets: Record<number, number[]> = {}

  data.forEach(row => {
    if (row.temperature == null) return

    const t = new Date(row.time).getTime()
    if (!t) return

    const rounded = Math.floor(t / (15 * 60 * 1000)) * (15 * 60 * 1000)

    if (!buckets[rounded]) buckets[rounded] = []
    buckets[rounded].push(Number(row.temperature))
  })

  return Object.entries(buckets).map(([time, temps]) => ({
    time: Number(time),
    temperature: safe(temps.reduce((a, b) => a + b, 0) / temps.length),
    rain: null
  }))
}

// ---------- MAIN ----------
export default function Page() {
  const [data, setData] = useState<ChartPoint[]>([])
  const [range, setRange] = useState(7)

  useEffect(() => {
    let mounted = true

    const fetchAll = async () => {
      const since = Date.now() - range * 86400000
      const sinceISO = new Date(since).toISOString()
      const sinceDay = sinceISO.slice(0, 10)

      const { data: tempRaw } = await supabase
        .from('netatmo_measurements')
        .select('time, temperature, module_name')
        .gte('time', sinceISO)
        .eq('module_name', 'Outdoor')
        .order('time', { ascending: true })

      const { data: rainRaw } = await supabase
        .from('netatmo_daily_stats')
        .select('day, rain_sum')
        .gte('day', sinceDay)

      if (!mounted) return

      const tempData = aggregate15min(tempRaw ?? [])

      const rainMap: Record<string, number> = {}
      ;(rainRaw as RainRow[] || []).forEach(r => {
        rainMap[r.day] = safe(r.rain_sum)
      })

      const counts: Record<string, number> = {}
      tempData.forEach(p => {
        const d = new Date(p.time).toISOString().slice(0, 10)
        counts[d] = (counts[d] || 0) + 1
      })

      const merged = tempData.map(p => {
        const d = new Date(p.time).toISOString().slice(0, 10)

        const rainVal = counts[d]
          ? rainMap[d] / counts[d]
          : 0

        return {
          time: p.time,
          temperature: safe(p.temperature),
          rain: rainVal > 0 ? rainVal : null
        }
      })

      setData(merged)
    }

    fetchAll()
    const i = setInterval(fetchAll, 4 * 60 * 1000)

    return () => {
      mounted = false
      clearInterval(i)
    }
  }, [range])

  return (
    <div style={{ padding: 8 }}>

      {/* BUTTONS */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 6 }}>
        {[7, 14, 30].map(r => (
          <button key={r} onClick={() => setRange(r)}>
            {r}d
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid vertical={false} />

          <XAxis
            dataKey="time"
            type="number"
            domain={['auto', 'auto']}
            tickFormatter={(t) =>
              new Date(t).toLocaleDateString('sk-SK', {
                day: '2-digit',
                month: '2-digit'
              })
            }
          />

          <YAxis yAxisId="temp" />
          <YAxis yAxisId="rain" orientation="right" />

          <Tooltip
            labelFormatter={(l) =>
              new Date(l).toLocaleString('sk-SK')
            }
          />

          <Bar yAxisId="rain" dataKey="rain" barSize={6} />

          <Area
            yAxisId="temp"
            type="monotone"
            dataKey="temperature"
            fill="rgba(59,130,246,0.12)"
          />

          <Line
            yAxisId="temp"
            type="monotone"
            dataKey="temperature"
            stroke="#22c55e"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
