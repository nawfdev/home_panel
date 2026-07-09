import { useEffect, useRef } from "react";
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
} from "chart.js";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip);

interface MetricPoint {
  timestamp: string;
  value: number;
}

export function PerformanceChart({ title, data, color }: { title: string; data: MetricPoint[]; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (!chartRef.current) {
      chartRef.current = new Chart(canvasRef.current, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              data: [],
              borderColor: color,
              backgroundColor: `${color}22`,
              fill: true,
              tension: 0.3,
              pointRadius: 0,
              borderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          scales: {
            y: {
              min: 0,
              max: 100,
              ticks: { color: "#544b40", stepSize: 50, font: { size: 10 } },
              grid: { color: "rgba(255,255,255,0.05)" },
              border: { display: false },
            },
            x: {
              ticks: { color: "#544b40", maxTicksLimit: 5, font: { size: 10 } },
              grid: { display: false },
              border: { color: "rgba(255,255,255,0.08)" },
            },
          },
          plugins: { legend: { display: false } },
        },
      });
    }

    const chart = chartRef.current;
    chart.data.labels = data.map((d) => new Date(d.timestamp).toLocaleTimeString());
    chart.data.datasets[0].data = data.map((d) => d.value);
    chart.update();
  }, [data, color]);

  useEffect(() => {
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  return (
    <div className="panel p-4">
      <h4 className="font-semibold mb-3 text-sm text-gray-300">{title}</h4>
      <div style={{ height: 200 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
