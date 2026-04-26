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
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
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
  rain?: number | null
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
      temperature:
        temps.reduce((a, b) => a + b, 0) / temps.length,
      rain: null
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

// ---------- custom ticks ----------
const CustomTick = ({ x, y, payload }: any) => {
  const d = new Date(payload.value)
  if (isNaN(d.getTime()) || d.getHours() !== 0) return null

  const date = d.toLocaleDateString('sk-SK', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
  })

  return (
    <g transform={`translate(${x},${y})`}>
      <text y={10} textAnchor="middle" fill="#000" fontSize={11} fontWeight={600}>
        {date}
      </text>
    </g>
  )
}

const CustomYTick = ({ y, payload }: any) => (
  <text x={4} y={y + 3} fill="#000" fontSize={11}>
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
        ☔ {Number(rain).toFixed(2)} mm
      </div>
    </div>
  )
}

// ---------- MAIN ----------
export default function Page() {
  const [data, setData] = useState<ChartPoint[]>([])
  const [range, setRange] = useState(7)

  const channelRef = useRef<any>(null)

  // iframe resize
  useEffect(() => {
    const sendHeight = () => {
      const height = document.documentElement.scrollHeight
      window.parent.postMessage({ type: 'resize', height }, '*')
    }

    setTimeout(sendHeight, 100)
    setTimeout(sendHeight, 300)
    setTimeout(sendHeight, 600)

    window.addEventListener('resize', sendHeight)
    return () => window.removeEventListener('resize', sendHeight)
  }, [])

  useEffect(() => {
    let mounted = true

    const fetchData = async () => {
      const sinceDate = new Date(Date.now() - range * 86400000)
      const sinceISO = sinceDate.toISOString()
      const sinceDay = sinceISO.slice(0, 10)

      // temp
      const { data: tempRaw } = await supabase
        .from('netatmo_measurements')
        .select('time, temperature, module_name')
        .gte('time', sinceISO)
        .eq('module_name', 'Outdoor')
        .not('temperature', 'is', null)
        .order('time', { ascending: true })

      // rain
      const { data: rainRaw } = await supabase
        .from('netatmo_daily_stats')
        .select('day, rain_sum')
        .gte('day', sinceDay)
        .order('day', { ascending: true })

      if (!mounted) return

      const tempData = smooth(aggregate15min(tempRaw as Row[]))

      // rain map
      const rainMap: Record<string, number> = {}
      ;(rainRaw as RainRow[] || []).forEach(r => {
        rainMap[r.day] = typeof r.rain_sum === 'number' ? r.rain_sum : 0
      })

      // counts per day
      const counts: Record<string, number> = {}
      tempData.forEach(p => {
        const d = p.time.slice(0, 10)
        counts[d] = (counts[d] || 0) + 1
      })

      // merge
      const merged = tempData.map(p => {
        const d = p.time.slice(0, 10)

        const rainVal = counts[d]
          ? (rainMap[d] || 0) / counts[d]
          : 0

        return {
          ...p,
          rain: rainVal > 0 ? rainVal : null
        }
      })

      setData(merged)
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

  const stats = useMemo(() => {
    if (!data.length) return null
    const temps = data.map(d => d.temperature)
    return {
      min: Math.min(...temps).toFixed(1),
      max: Math.max(...temps).toFixed(1),
    }
  }, [data])

  const ticks = useMemo(() => generateTicks(data), [data])
  const midnightLines = ticks.filter(t => new Date(t).getHours() === 0)

  return (
    <div style={{ padding: 8 }}>
      {/* RANGE */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {[7, 14, 30].map(r => (
          <button key={r} onClick={() => setRange(r)}>
            {r}d
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid stroke="#cbd5e1" vertical={false} />

          {midnightLines.map((t) => (
            <ReferenceLine key={t} x={t} stroke="#cbd5e1" strokeOpacity={0.6} />
          ))}

          <ReferenceLine y={0} stroke="#000" strokeWidth={1.5} />

          <XAxis
            dataKey="time"
            ticks={ticks}
            interval={0}
            tick={<CustomTick />}
            axisLine={false}
            tickLine={false}
          />

          <YAxis tick={<CustomYTick />} axisLine={false} tickLine={false} width={30} />

          <Tooltip content={<CustomTooltip />} />

          {/* 🌧️ Rain */}
          <Bar dataKey="rain" fill="#38bdf8" barSize={6} />

          {/* 🌡️ Temperature */}
          <Area type="monotone" dataKey="temperature" fill="rgba(59,130,246,0.12)" baseValue={0} />

          <Line type="monotone" dataKey="temperature" stroke="#22c55e" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
