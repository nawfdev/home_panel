// Package metrics ports backend/services/metrics.js: an in-memory ring of the
// last 24h of samples (1-minute cadence) for cpu, memory, network and temperature.
package metrics

import (
	"bufio"
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/nawfdev/home-panel/internal/sysstats"
)

const (
	maxDataPoints = 1440 // 24h at 1-minute intervals
	retention     = 24 * time.Hour
)

// Point is one {timestamp, value} sample (timestamp in ms epoch, like Date.now()).
type Point struct {
	Timestamp int64   `json:"timestamp"`
	Value     float64 `json:"value"`
}

type storedPoint struct {
	Metric string `json:"metric"`
	Point
}

type Collector struct {
	mu          sync.RWMutex
	file        string
	lastRewrite time.Time
	cpu         []Point
	memory      []Point
	networkRx   []Point
	networkTx   []Point
	temperature []Point
}

// Open restores samples from the last 24 hours and keeps future samples on disk.
func Open(file string) (*Collector, error) {
	c := &Collector{file: file, lastRewrite: time.Now()}
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return nil, err
	}
	f, err := os.Open(file)
	if err == nil {
		cutoff := time.Now().Add(-retention).UnixMilli()
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			var sample storedPoint
			if json.Unmarshal(scanner.Bytes(), &sample) == nil && sample.Timestamp >= cutoff {
				c.pushStored(sample)
			}
		}
		closeErr := f.Close()
		if err := scanner.Err(); err != nil {
			return nil, err
		}
		if closeErr != nil {
			return nil, closeErr
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if err := c.rewrite(); err != nil {
		return nil, err
	}
	return c, nil
}

func push(buf []Point, p Point) []Point {
	buf = append(buf, p)
	if len(buf) > maxDataPoints {
		buf = buf[len(buf)-maxDataPoints:]
	}
	return buf
}

func (c *Collector) pushStored(sample storedPoint) {
	switch sample.Metric {
	case "cpu":
		c.cpu = push(c.cpu, sample.Point)
	case "memory":
		c.memory = push(c.memory, sample.Point)
	case "network_rx":
		c.networkRx = push(c.networkRx, sample.Point)
	case "network_tx":
		c.networkTx = push(c.networkTx, sample.Point)
	case "temperature":
		c.temperature = push(c.temperature, sample.Point)
	}
}

func (c *Collector) appendLocked(samples []storedPoint) {
	f, err := os.OpenFile(c.file, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	encoder := json.NewEncoder(f)
	for _, sample := range samples {
		_ = encoder.Encode(sample)
	}
	_ = f.Close()
}

func (c *Collector) rewrite() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.rewriteLocked()
}

func (c *Collector) rewriteLocked() error {
	f, err := os.OpenFile(c.file, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(f)
	series := []struct {
		metric string
		points []Point
	}{
		{"cpu", c.cpu},
		{"memory", c.memory},
		{"network_rx", c.networkRx},
		{"network_tx", c.networkTx},
		{"temperature", c.temperature},
	}
	for _, item := range series {
		for _, point := range item.points {
			if err := encoder.Encode(storedPoint{Metric: item.metric, Point: point}); err != nil {
				_ = f.Close()
				return err
			}
		}
	}
	if err := f.Close(); err != nil {
		return err
	}
	c.lastRewrite = time.Now()
	return nil
}

func (c *Collector) collect(ctx context.Context) {
	stats, err := sysstats.GetSystemStats(ctx)
	if err != nil {
		return
	}
	ts := time.Now().UnixMilli()
	samples := []storedPoint{
		{Metric: "cpu", Point: Point{ts, stats.CPU.Usage}},
		{Metric: "memory", Point: Point{ts, stats.Memory.UsagePercent}},
	}
	if len(stats.Network) > 0 {
		var totalRx, totalTx float64
		for _, n := range stats.Network {
			totalRx += n.RxSec
			totalTx += n.TxSec
		}
		samples = append(samples,
			storedPoint{Metric: "network_rx", Point: Point{ts, totalRx / 1024 / 1024}},
			storedPoint{Metric: "network_tx", Point: Point{ts, totalTx / 1024 / 1024}},
		)
	}
	temp := sysstats.GetTemperature(ctx)
	if temp.Available && temp.Main != nil && *temp.Main > 0 {
		samples = append(samples, storedPoint{Metric: "temperature", Point: Point{ts, math.Round(*temp.Main)}})
	}

	c.mu.Lock()
	for _, sample := range samples {
		c.pushStored(sample)
	}
	c.appendLocked(samples)
	if time.Since(c.lastRewrite) >= time.Hour {
		_ = c.rewriteLocked()
	}
	c.mu.Unlock()
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
