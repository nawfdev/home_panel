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

// A chart panel this size can't usefully distinguish more points than this
// anyway, and it's a permanent safety net independent of how much history
// the backend ever returns (e.g. if retention/collection frequency changes
// later) — feeding thousands of points into Chart.js is what made this
// chart hang/crash on mobile. Always keeps the most recent point so the
// current reading is never stale.
const MAX_POINTS = 300;

function downsample(points: TrafficPoint[]): TrafficPoint[] {
  if (points.length <= MAX_POINTS) return points;
  const stride = Math.ceil(points.length / MAX_POINTS);
  const out: TrafficPoint[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
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
          // High-DPI phones (3x devicePixelRatio is common) multiply the
          // canvas backing-store resolution; capped so a large chart on a
          // high-DPI mobile screen never allocates a canvas far bigger
          // than it's ever displayed at.
          devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
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
    const points = downsample(data);
    chart.data.labels = points.map((point) => new Date(point.timestamp).toLocaleString());
    chart.data.datasets[0].data = points.map((point) => point.rxSec);
    chart.data.datasets[1].data = points.map((point) => point.txSec);
    chart.update();
  }, [data]);

  useEffect(() => () => {
    chartRef.current?.destroy();
    chartRef.current = null;
  }, []);

  return <div className="h-64"><canvas ref={canvasRef} /></div>;
}
