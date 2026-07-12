// Package metrics ports backend/services/metrics.js: an in-memory ring of the
// last 24h of samples (1-minute cadence) for cpu, memory, network and temperature.
package metrics

import (
	"context"
	"math"
	"sync"
	"time"

	"github.com/nawfdev/home-panel/internal/sysstats"
)

const maxDataPoints = 1440 // 24h at 1-minute intervals

// Point is one {timestamp, value} sample (timestamp in ms epoch, like Date.now()).
type Point struct {
	Timestamp int64   `json:"timestamp"`
	Value     float64 `json:"value"`
}

type Collector struct {
	mu          sync.RWMutex
	cpu         []Point
	memory      []Point
	networkRx   []Point
	networkTx   []Point
	temperature []Point
}

func New() *Collector { return &Collector{} }

func push(buf []Point, p Point) []Point {
	buf = append(buf, p)
	if len(buf) > maxDataPoints {
		buf = buf[len(buf)-maxDataPoints:]
	}
	return buf
}

func (c *Collector) collect(ctx context.Context) {
	stats, err := sysstats.GetSystemStats(ctx)
	if err != nil {
		return
	}
	ts := time.Now().UnixMilli()

	c.mu.Lock()
	c.cpu = push(c.cpu, Point{ts, stats.CPU.Usage})
	c.memory = push(c.memory, Point{ts, stats.Memory.UsagePercent})

	if len(stats.Network) > 0 {
		var totalRx, totalTx float64
		for _, n := range stats.Network {
			totalRx += n.RxSec
			totalTx += n.TxSec
		}
		c.networkRx = push(c.networkRx, Point{ts, totalRx / 1024 / 1024}) // MB/s
		c.networkTx = push(c.networkTx, Point{ts, totalTx / 1024 / 1024})
	}
	c.mu.Unlock()

	temp := sysstats.GetTemperature(ctx)
	if temp.Available && temp.Main != nil && *temp.Main > 0 {
		c.mu.Lock()
		c.temperature = push(c.temperature, Point{ts, math.Round(*temp.Main)})
		c.mu.Unlock()
	}
}

// Start runs an initial collection then ticks every 60s until ctx is cancelled.
func (c *Collector) Start(ctx context.Context) {
	c.collect(ctx)
	go func() {
		t := time.NewTicker(60 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				c.collect(ctx)
			}
		}
	}()
}

// Historical returns the series for a metric key, matching getHistoricalData.
// Keys: cpu, memory, network_rx, network_tx, temperature.
func (c *Collector) Historical(metric string) []Point {
	c.mu.RLock()
	defer c.mu.RUnlock()
	var src []Point
	switch metric {
	case "cpu":
		src = c.cpu
	case "memory":
		src = c.memory
	case "network_rx":
		src = c.networkRx
	case "network_tx":
		src = c.networkTx
	case "temperature":
		src = c.temperature
	default:
		return []Point{}
	}
	out := make([]Point, len(src))
	copy(out, src)
	return out
}
