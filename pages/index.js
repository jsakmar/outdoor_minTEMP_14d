import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(LineElement, CategoryScale, LinearScale, PointElement);

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

    if (error) {
      console.error(error);
    } else {
      setData(data);
    }
  }

  const chartData = {
    labels: data.map(d =>
      new Date(d.day).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short'
      })
    ),
    datasets: [
      {
        label: 'outdoor_minTEMP_14d',
        data: data.map(d => d.outdoor_min),
        borderWidth: 2
      }
    ]
  };

  return (
    <div style={{ maxWidth: 700, margin: '50px auto', padding: 20 }}>
      <h2>Outdoor Min Temperature (Last 14 Days)</h2>
      <Line data={chartData} />
    </div>
  );
}
