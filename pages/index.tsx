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
  module_name: string
}

type ChartPoint = {
  time: string
  temperature: number
}

const TZ = 'Europe/Bratislava'

/* =========================================================
   DATA PROCESSING
   ========================================================= */

function aggregate15min(data: Row[]): ChartPoint[] {
  const buckets: Record<string, number[]> = {}

  data.forEach(row => {
    const d = new Date(row.time)

    if (isNaN(d.getTime())) return

    d.setMinutes(
      Math.floor(d.getMinutes() / 15) * 15,
      0,
      0
    )

    const key = d.toISOString()

    if (!buckets[key]) {
      buckets[key] = []
    }

    buckets[key].push(row.temperature)
  })

  return Object.entries(buckets)
    .map(([time, temps]) => ({
      time,
      temperature:
        temps.reduce((a, b) => a + b, 0) /
        temps.length,
    }))
    .sort(
      (a, b) =>
        new Date(a.time).getTime() -
        new Date(b.time).getTime()
    )
}

function smooth(data: ChartPoint[]): ChartPoint[] {
  const w = 3

  return data.map((p, i) => {
    const slice = data.slice(
      Math.max(0, i - w),
      Math.min(data.length, i + w + 1)
    )

    const avg =
      slice.reduce(
        (s, x) => s + x.temperature,
        0
      ) / slice.length

    return {
      ...p,
      temperature: Number(avg.toFixed(1)),
    }
  })
}

/* =========================================================
   DATE / TIME HELPERS
   ========================================================= */

function getDateKeyInTZ(dateStr: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(dateStr))
}

function formatAxisDate(dateStr: string) {
  return new Intl.DateTimeFormat('sk-SK', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(dateStr))
}

/*
 * Return one real chart point for each Bratislava
 * calendar day.
 *
 * We deliberately do NOT require a measurement
 * exactly at 00:00. The first available 15-minute
 * point for that calendar day becomes its anchor.
 */
function generateDailyTicks(
  data: ChartPoint[]
): string[] {
  if (!data.length) return []

  const result: string[] = []
  let lastDate = ''

  for (const point of data) {
    const dateKey = getDateKeyInTZ(point.time)

    if (dateKey !== lastDate) {
      result.push(point.time)
      lastDate = dateKey
    }
  }

  return result
}

/*
 * Reduce the number of visible X-axis labels.
 *
 * Daily reference lines are kept separately, so
 * reducing labels does NOT remove the day guides.
 */
function selectVisibleTicks(
  dailyTicks: string[],
  range: number,
  isMobile: boolean
): string[] {
  if (!dailyTicks.length) return []

  let step = 1

  if (isMobile) {
    if (range <= 7) {
      step = 2
    } else if (range <= 14) {
      step = 3
    } else {
      step = 5
    }
  } else {
    if (range <= 7) {
      step = 1
    } else if (range <= 14) {
      step = 2
    } else {
      step = 4
    }
  }

  const selected = dailyTicks.filter(
    (_, index) => index % step === 0
  )

  /*
   * Keep the final available day as well.
   */
  const last =
    dailyTicks[dailyTicks.length - 1]

  if (
    last &&
    selected[selected.length - 1] !== last
  ) {
    selected.push(last)
  }

  return selected
}

/* =========================================================
   TOOLTIP
   ========================================================= */

const CustomTooltip = ({
  active,
  payload,
  label,
}: any) => {
  if (!active || !payload?.length) return null

  const d = new Date(label)

  const time = d.toLocaleTimeString('sk-SK', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  })

  const temp = payload.find(
    (p: any) =>
      p.dataKey === 'temperature'
  )?.value

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 6,
        padding: '4px 6px',
        boxShadow:
          '0 2px 4px rgba(0,0,0,0.05)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: '#64748b',
          marginBottom: 2,
        }}
      >
        {time}
      </div>

      <div
        style={{
          fontWeight: 700,
          fontSize: 13,
          color: '#22c55e',
        }}
      >
        {temp}°C
      </div>
    </div>
  )
}

/* =========================================================
   PAGE
   ========================================================= */

export default function Home() {
  const [data, setData] =
    useState<ChartPoint[]>([])

  const [range, setRange] =
    useState(14)

  const [loading, setLoading] =
    useState(true)

  const [isMobile, setIsMobile] =
    useState(false)

  const containerRef =
    useRef<HTMLDivElement>(null)

  /* =======================================================
     FETCH DATA
     ======================================================= */

  const fetchAll = async () => {
    const sinceDate = new Date(
      Date.now() -
        range * 86400000
    )

    const sinceISO =
      sinceDate.toISOString()

    const { data: tempRaw } =
      await supabase
        .from('netatmo_measurements')
        .select(
          'time, temperature, module_name'
        )
        .gte('time', sinceISO)
        .eq('module_name', 'Outdoor')
        .not('temperature', 'is', null)
        .order('time', {
          ascending: true,
        })

    const processedData = smooth(
      aggregate15min(tempRaw ?? [])
    )

    setData(processedData)
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()

    const interval = setInterval(
      fetchAll,
      4 * 60 * 1000
    )

    return () =>
      clearInterval(interval)
  }, [range])

  /* =======================================================
     RESPONSIVE STATE
     ======================================================= */

  useEffect(() => {
    const updateMobileState = () => {
      setIsMobile(
        window.innerWidth <= 560
      )
    }

    updateMobileState()

    window.addEventListener(
      'resize',
      updateMobileState
    )

    window.addEventListener(
      'orientationchange',
      updateMobileState
    )

    return () => {
      window.removeEventListener(
        'resize',
        updateMobileState
      )

      window.removeEventListener(
        'orientationchange',
        updateMobileState
      )
    }
  }, [])

  /* =======================================================
     IFRAME AUTO RESIZE
     ======================================================= */

  useEffect(() => {
    if (
      loading ||
      !containerRef.current
    ) {
      return
    }

    const dispatchHeight = () => {
      if (!containerRef.current) {
        return
      }

      const height = Math.ceil(
        containerRef.current
          .getBoundingClientRect()
          .height
      )

      window.parent.postMessage(
        {
          type: 'resize',
          height: height + 2,
        },
        '*'
      )
    }

    const resizeObserver =
      new ResizeObserver(() => {
        dispatchHeight()
      })

    resizeObserver.observe(
      containerRef.current
    )

    const handleOrientationChange =
      () => {
        setTimeout(
          dispatchHeight,
          200
        )

        setTimeout(
          dispatchHeight,
          500
        )
      }

    window.addEventListener(
      'resize',
      handleOrientationChange
    )

    window.addEventListener(
      'orientationchange',
      handleOrientationChange
    )

    return () => {
      resizeObserver.disconnect()

      window.removeEventListener(
        'resize',
        handleOrientationChange
      )

      window.removeEventListener(
        'orientationchange',
        handleOrientationChange
      )
    }
  }, [loading, data])

  /* =======================================================
     STATISTICS
     ======================================================= */

  const stats = useMemo(() => {
    if (!data.length) return null

    const temps = data.map(
      d => d.temperature
    )

    return {
      min: Math.min(
        ...temps
      ).toFixed(1),

      max: Math.max(
        ...temps
      ).toFixed(1),
    }
  }, [data])

  /* =======================================================
     X AXIS
     ======================================================= */

  /*
   * One anchor per Bratislava calendar day.
   */
  const dailyTicks = useMemo(
    () => generateDailyTicks(data),
    [data]
  )

  /*
   * Responsive subset used only for X-axis labels.
   */
  const visibleTicks = useMemo(
    () =>
      selectVisibleTicks(
        dailyTicks,
        range,
        isMobile
      ),
    [
      dailyTicks,
      range,
      isMobile,
    ]
  )

  /* =======================================================
     LOADING
     ======================================================= */

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '310px',
          fontFamily: 'system-ui',
          color: '#64748b',
        }}
      >
        Loading temperature data...
      </div>
    )
  }

  /* =======================================================
     RENDER
     ======================================================= */

  return (
    <main
      style={{
        fontFamily:
          'system-ui, sans-serif',
        background: '#fff',
        padding: 0,
        margin: 0,
        boxSizing: 'border-box',
        overflow: 'hidden',
        height: 'auto',
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          maxWidth: '100%',
          background: '#fff',
          padding: '2px 4px 0px 0px',
          boxSizing: 'border-box',
          overflow: 'hidden',
          height: 'auto',
        }}
      >
        {/* ===============================
            BUTTONS
            =============================== */}

        <div
          style={{
            display: 'flex',
            gap: 6,
            marginBottom: 6,
            padding: '0 2px',
          }}
        >
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
                border:
                  '1px solid #e2e8f0',
                background:
                  range === r
                    ? '#22c55e'
                    : '#f8fafc',
                color:
                  range === r
                    ? '#fff'
                    : '#64748b',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <div>{r}d</div>

              {stats &&
                range === r && (
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      marginTop: 1,
                      opacity: 0.95,
                    }}
                  >
                    ↓{stats.min}°C ↑
                    {stats.max}°C
                  </div>
                )}
            </button>
          ))}
        </div>

        {/* ===============================
            CHART
            =============================== */}

        <div
          style={{
            height: 230,
            width: '100%',
          }}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
          >
            <LineChart
              data={data}
              margin={{
                top: 6,
                right: isMobile
                  ? 8
                  : 4,
                left: -24,
                bottom: 1,
              }}
            >
              <CartesianGrid
                stroke="#e2e8f0"
                vertical={false}
              />

              {/* Daily vertical guides */}
              {dailyTicks.map(t => (
                <ReferenceLine
                  key={t}
                  x={t}
                  stroke="#cbd5e1"
                  strokeWidth={1}
                />
              ))}

              {/* Zero degree line */}
              <ReferenceLine
                y={0}
                stroke="#475569"
                strokeWidth={1.2}
              />

              <YAxis
                axisLine={false}
                tickLine={false}
                width={30}
                tick={{
                  fill: '#000',
                  fontSize: 10,
                  fontWeight: 500,
                }}
                domain={[
                  'auto',
                  'auto',
                ]}
              />

              <XAxis
                dataKey="time"
                ticks={visibleTicks}
                interval={0}
                axisLine={false}
                tickLine={false}
                minTickGap={isMobile ? 12 : 18}
                height={24}
                tickMargin={4}
                tickFormatter={
                  formatAxisDate
                }
                tick={{
                  fill: '#000',
                  fontSize:
                    isMobile
                      ? 9
                      : 10,
                  fontWeight: 500,
                }}
              />

              <Tooltip
                content={
                  <CustomTooltip />
                }
                shared={true}
              />

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
                activeDot={{
                  r: 4,
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </main>
  )
}
