import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend
);

export default function Home() {
  const [data, setData] = useState([]);

  useEffect(() => {
    fetchTemps();
  }, []);

  async function fetchTemps() {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 14);

    const { data, error } = await supabase
      .from('netatmo_daily_stats')
      .select('day, outdoor_min')
      .gte('day', fromDate.toISOString().split('T')[0])
      .not('outdoor_min', 'is', null)
      .order('day', { ascending: true });

    if (!error) setData(data);
    else console.error(error);
  }

  const formatDate = (d) =>
    new Date(d).toLocaleDateString('en-GB', {
      timeZone: 'Europe/Bratislava',
      day: '2-digit',
      month: 'short'
    });

  const chartData = {
    labels: data.map(d => formatDate(d.day)),
    datasets: [
      {
        label: 'Temperature (°C)',
        data: data.map(d => d.outdoor_min),
        borderColor: '#e53935',   // red line
        backgroundColor: '#e53935',
        borderWidth: 2,
        tension: 0.4,             // smooth curve
        pointRadius: 0            // remove dots
      }
    ]
  };

  const options = {
    responsive: true,
    plugins: {
      legend: {
        display: true,
        position: 'bottom'
      },
      tooltip: {
        mode: 'index',
        intersect: false
      }
    },
    scales: {
      y: {
        ticks: {
          callback: (value) => `${value}°C`
        }
      }
    }
  };

  return (
    <div style={{
      maxWidth: 900,
      margin: '40px auto',
      padding: 20,
      fontFamily: 'Arial'
    }}>
      <h2 style={{ marginBottom: 10 }}>
        outdoor_minTEMP_14d
      </h2>

      <p style={{ color: '#666', marginBottom: 20 }}>
        Last 14 days (Europe/Bratislava)
      </p>

      <div style={{
        background: '#fff',
        padding: 20,
        borderRadius: 12,
        boxShadow: '0 2px 10px rgba(0,0,0,0.05)'
      }}>
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
