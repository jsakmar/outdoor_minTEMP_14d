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

// ---------- aggregation ----------
function aggregate15min(
  data: Row[]
): ChartPoint[] {
  const buckets: Record<
    string,
    number[]
  > = {}

  data.forEach(row => {
    const d = new Date(row.time)

    if (isNaN(d.getTime())) return

    d.setMinutes(
      Math.floor(
        d.getMinutes() / 15
      ) * 15,
      0,
      0
    )

    const key = d.toISOString()

    if (!buckets[key]) {
      buckets[key] = []
    }

    buckets[key].push(
      row.temperature
    )
  })

  return Object.entries(
    buckets
  )
    .map(([time, temps]) => ({
      time,
      temperature:
        temps.reduce(
          (a, b) => a + b,
          0
        ) / temps.length,
      rain: null
    }))
    .sort(
      (a, b) =>
        new Date(
          a.time
        ).getTime() -
        new Date(
          b.time
        ).getTime()
    )
}

// ---------- smoothing ----------
function smooth(
  data: ChartPoint[]
): ChartPoint[] {
  const w = 3

  return data.map((p, i) => {
    const slice = data.slice(
      Math.max(0, i - w),
      Math.min(
        data.length,
        i + w + 1
      )
    )

    const avg =
      slice.reduce(
        (s, x) =>
          s + x.temperature,
        0
      ) / slice.length

    return {
      ...p,
      temperature: Number(
        avg.toFixed(1)
      )
    }
  })
}

// ---------- ticks ----------
function generateTicks(
  data: ChartPoint[]
) {
  if (!data.length) return []

  const start = new Date(
    data[0].time
  )

  const end = new Date(
    data[data.length - 1].time
  )

  const ticks: string[] = []

  const c = new Date(start)

  c.setMinutes(0, 0, 0)

  while (c <= end) {
    ticks.push(
      c.toISOString()
    )

    c.setHours(
      c.getHours() + 1
    )
  }

  return ticks
}

// ---------- timezone-safe hour ----------
function getHourInTZ(
  dateStr: string
) {
  return Number(
    new Date(
      dateStr
    ).toLocaleString(
      'en-GB',
      {
        hour: '2-digit',
        hour12: false,
        timeZone: TZ
      }
    )
  )
}

// ---------- tooltip ----------
const CustomTooltip = ({
  active,
  payload,
  label
}: any) => {
  if (
    !active ||
    !payload?.length
  ) {
    return null
  }

  const d = new Date(label)

  const time =
    d.toLocaleTimeString(
      'sk-SK',
      {
        timeZone: TZ,
        hour: '2-digit',
        minute: '2-digit',
      }
    )

  const temp =
    payload.find(
      (p: any) =>
        p.dataKey ===
        'temperature'
    )?.value

  // rain comes directly from row data
  const rain =
    payload?.[0]?.payload?.rain

  return (
    <div
      style={{
        background: '#fff',
        border:
          '1px solid #e2e8f0',
        borderRadius: 6,
        padding: '6px 8px'
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: '#64748b'
        }}
      >
        {time}
      </div>

      <div
        style={{
          fontWeight: 700,
          fontSize: 14,
          color: '#22c55e'
        }}
      >
        {temp}°C
      </div>

      {typeof rain ===
        'number' && (
        <div
          style={{
            fontSize: 12,
            color: '#0ea5e9'
          }}
        >
          {rain.toFixed(1)} mm
        </div>
      )}
    </div>
  )
}

// ---------- MAIN ----------
export default function Page() {
  const [data, setData] =
    useState<
      ChartPoint[]
    >([])

  const [range, setRange] =
    useState(7)

  useEffect(() => {
    let mounted = true

    const fetchAll =
      async () => {
        const sinceDate =
          new Date(
            Date.now() -
              range *
                86400000
          )

        const sinceISO =
          sinceDate.toISOString()

        const sinceDay =
          sinceISO.slice(
            0,
            10
          )

        // temperatures
        const {
          data: tempRaw
        } = await supabase
          .from(
            'netatmo_measurements'
          )
          .select(
            'time, temperature, module_name'
          )
          .gte(
            'time',
            sinceISO
          )
          .eq(
            'module_name',
            'Outdoor'
          )
          .not(
            'temperature',
            'is',
            null
          )
          .order(
            'time',
            {
              ascending: true
            }
          )

        // rain
        const {
          data: rainRaw
        } = await supabase
          .from(
            'netatmo_daily_stats'
          )
          .select(
            'day, rain_sum'
          )
          .gte(
            'day',
            sinceDay
          )

        if (!mounted) return

        const tempData =
          smooth(
            aggregate15min(
              tempRaw ?? []
            )
          )

        const rainMap: Record<
          string,
          number
        > = {}

        ;(
          (rainRaw as RainRow[]) ||
          []
        ).forEach(r => {
          rainMap[r.day] =
            typeof r.rain_sum ===
            'number'
              ? r.rain_sum
              : 0
        })

        const merged =
          tempData.map(
            p => {
              const day =
                p.time.slice(
                  0,
                  10
                )

              const hour =
                getHourInTZ(
                  p.time
                )

              const total =
                rainMap[day] ||
                0

              // cumulative rain progression
              const rainVal =
                total *
                ((hour + 1) /
                  24)

              return {
                ...p,
                rain:
                  rainVal >
                  0.2
                    ? Number(
                        rainVal.toFixed(
                          2
                        )
                      )
                    : null
              }
            }
          )

        setData(merged)
      }

    fetchAll()

    const interval =
      setInterval(
        fetchAll,
        4 * 60 * 1000
      )

    return () => {
      mounted = false
      clearInterval(
        interval
      )
    }
  }, [range])

  // ---------- stats ----------
  const stats = useMemo(() => {
    if (!data.length) {
      return null
    }

    const temps = data.map(
      d => d.temperature
    )

    const rainPerDay =
      new Map<
        string,
        number
      >()

    data.forEach(d => {
      if (
        typeof d.rain ===
        'number'
      ) {
        const day =
          d.time.slice(
            0,
            10
          )

        const current =
          rainPerDay.get(
            day
          ) || 0

        if (
          d.rain >
          current
        ) {
          rainPerDay.set(
            day,
            d.rain
          )
        }
      }
    })

    const rainTotal =
      Array.from(
        rainPerDay.values()
      ).reduce(
        (a, b) => a + b,
        0
      )

    return {
      min: Math.min(
        ...temps
      ).toFixed(1),

      max: Math.max(
        ...temps
      ).toFixed(1),

      rain: rainTotal
    }
  }, [data])

  const ticks = useMemo(
    () =>
      generateTicks(data),
    [data]
  )

  const midnightLines =
    ticks.filter(
      t =>
        getHourInTZ(t) ===
        0
    )

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 1150,
        margin: '0 auto',
        height: 280,
        paddingTop: 6,
        boxSizing:
          'border-box'
      }}
    >
      {/* buttons */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 4,
          padding:
            '0 6px'
        }}
      >
        {[7, 14, 30].map(
          r => (
            <button
              key={r}
              onClick={() =>
                setRange(r)
              }
              style={{
                flex: 1,
                padding:
                  '6px 0',
                borderRadius: 8,
                border:
                  '1px solid #e2e8f0',
                background:
                  range === r
                    ? '#22c55e'
                    : '#fff',
                color:
                  range === r
                    ? '#fff'
                    : '#64748b',
                fontSize: 12,
                cursor:
                  'pointer'
              }}
            >
              <div>
                {r}d
              </div>

              {stats &&
                range ===
                  r && (
                  <div
                    style={{
                      fontSize: 10
                    }}
                  >
                    ↓
                    {
                      stats.min
                    }
                    {' '}
                    ↑
                    {
                      stats.max
                    }
                    {' '}
                    {stats.rain.toFixed(
                      1
                    )}
                    mm
                  </div>
                )}
            </button>
          )
        )}
      </div>

      <ResponsiveContainer
        width="100%"
        height="100%"
      >
        <LineChart
          data={data}
          margin={{
            top: 16,
            right: 8,
            left: 0,
            bottom: 0
          }}
        >
          <CartesianGrid
            stroke="#cbd5e1"
            vertical={false}
          />

          {midnightLines.map(
            t => (
              <ReferenceLine
                key={t}
                x={t}
                stroke="#cbd5e1"
              />
            )
          )}

          <ReferenceLine
            y={0}
            stroke="#000"
            strokeWidth={
              1.5
            }
          />

          <YAxis
            axisLine={false}
            tickLine={false}
            width={30}
            tick={{
              fill: '#000',
              fontSize: 11
            }}
            domain={[
              'auto',
              'auto'
            ]}
          />

          <XAxis
            dataKey="time"
            ticks={ticks}
            interval={0}
            axisLine={false}
            tickLine={false}
            tick={({
              x,
              y,
              payload
            }) => {
              const d =
                new Date(
                  payload.value
                )

              if (
                getHourInTZ(
                  payload.value
                ) !== 0
              ) {
                return null
              }

              return (
                <g
                  transform={`translate(${x},${y})`}
                >
                  <text
                    y={-12}
                    textAnchor="middle"
                    fill="#334155"
                    fontSize={11}
                  >
                    {d.toLocaleDateString(
                      'sk-SK',
                      {
                        day: '2-digit',
                        month:
                          '2-digit'
                      }
                    )}
                  </text>
                </g>
              )
            }}
          />

          <Tooltip
            content={
              <CustomTooltip />
            }
          />

          <Area
            type="monotone"
            dataKey="temperature"
            fill="rgba(34,197,94,0.08)"
            stroke="none"
          />

          <Line
            type="monotone"
            dataKey="temperature"
            stroke="#22c55e"
            strokeWidth={2}
            dot={false}
            activeDot={{
              r: 4
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
