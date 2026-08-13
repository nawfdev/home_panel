import { useEffect, useRef } from "react";
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
} from "chart.js";
import { formatBytes } from "../../lib/format";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

interface TrafficPoint {
  timestamp: number;
  rxSec: number;
  txSec: number;
}

export function TrafficChart({ data }: { data: TrafficPoint[] }) {
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
            { label: "Download", data: [], borderColor: "#4ade80", backgroundColor: "#4ade8022", fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2 },
            { label: "Upload", data: [], borderColor: "#60a5fa", backgroundColor: "#60a5fa11", fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { intersect: false, mode: "index" },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: "#746b60", callback: (value) => `${formatBytes(Number(value))}/s`, font: { size: 10 } },
              grid: { color: "rgba(255,255,255,0.05)" },
              border: { display: false },
            },
            x: {
              ticks: { color: "#746b60", maxTicksLimit: 7, font: { size: 10 } },
              grid: { display: false },
              border: { color: "rgba(255,255,255,0.08)" },
            },
          },
          plugins: {
            legend: { labels: { color: "#9ca3af", boxWidth: 12, boxHeight: 2 } },
            tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${formatBytes(Number(item.raw))}/s` } },
          },
        },
      });
    }
    const chart = chartRef.current;
    chart.data.labels = data.map((point) => new Date(point.timestamp).toLocaleString());
    chart.data.datasets[0].data = data.map((point) => point.rxSec);
    chart.data.datasets[1].data = data.map((point) => point.txSec);
    chart.update();
  }, [data]);

  useEffect(() => () => {
    chartRef.current?.destroy();
    chartRef.current = null;
  }, []);

  return <div className="h-64"><canvas ref={canvasRef} /></div>;
}
