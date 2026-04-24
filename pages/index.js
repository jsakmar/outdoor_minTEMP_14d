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
  const [range, setRange] = useState(14); // default

  useEffect(() => {
    fetchTemps();
  }, [range]);

  async function fetchTemps() {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - range);

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
        borderColor: '#e53935',
        backgroundColor: '#e53935',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0
      }
    ]
  };

  const options = {
    responsive: true,
    plugins: {
      legend: {
        display: true,
        position: 'bottom'
      }
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', padding: 20 }}>
      <h2>outdoor_minTEMP_{range}d</h2>

      {/* RANGE SWITCH */}
      <div style={{ marginBottom: 20 }}>
        {[7, 14, 30].map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            style={{
              marginRight: 10,
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #ccc',
              background: range === r ? '#e53935' : '#fff',
              color: range === r ? '#fff' : '#000',
              cursor: 'pointer'
            }}
          >
            {r}d
          </button>
        ))}
      </div>

      <Line data={chartData} options={options} />
    </div>
  );
}
