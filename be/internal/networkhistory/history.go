// Package networkhistory persists per-host, per-interface traffic samples.
package networkhistory

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/nawfdev/home-panel/internal/netinfo"
	"github.com/nawfdev/home-panel/internal/sshmgr"
	"github.com/nawfdev/home-panel/internal/store"
)

const retention = 7 * 24 * time.Hour

type Sample struct {
	Timestamp int64   `json:"timestamp"`
	HostID    int     `json:"hostId"`
	Interface string  `json:"interface"`
	RxBytes   uint64  `json:"rxBytes"`
	TxBytes   uint64  `json:"txBytes"`
	RxSec     float64 `json:"rxSec"`
	TxSec     float64 `json:"txSec"`
}

type SeriesPoint struct {
	Timestamp int64   `json:"timestamp"`
	RxSec     float64 `json:"rxSec"`
	TxSec     float64 `json:"txSec"`
}

type Total struct {
	Interface string `json:"interface"`
	Download  uint64 `json:"download"`
	Upload    uint64 `json:"upload"`
}

type response struct {
	Samples []Sample `json:"samples"`
}

type Collector struct {
	mu       sync.RWMutex
	file     string
	store    *store.Store
	ssh      *sshmgr.Manager
	samples  []Sample
	previous map[string]Sample
}

func Open(file string, st *store.Store, ssh *sshmgr.Manager) (*Collector, error) {
	c := &Collector{file: file, store: st, ssh: ssh, previous: map[string]Sample{}}
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return nil, err
	}
	f, err := os.Open(file)
	if err == nil {
		cutoff := time.Now().Add(-retention).UnixMilli()
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			var sample Sample
			if json.Unmarshal(scanner.Bytes(), &sample) == nil && sample.Timestamp >= cutoff {
				c.samples = append(c.samples, sample)
				c.previous[key(sample.HostID, sample.Interface)] = sample
			}
		}
		_ = f.Close()
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if err := c.rewrite(); err != nil {
		return nil, err
	}
	return c, nil
}

func key(hostID int, iface string) string { return strconv.Itoa(hostID) + "\x00" + iface }

func (c *Collector) Start(ctx context.Context) {
	c.collect(ctx)
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c.collect(ctx)
			}
		}
	}()
}

func (c *Collector) collect(ctx context.Context) {
	c.record(0, netinfo.GetNetworkStats(ctx))
	for _, host := range c.store.ListHosts() {
		hostCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
		addresses, routes, resolv, dev, err := c.ssh.NetworkInfo(hostCtx, host)
		cancel()
		if err != nil {
			continue
		}
		snapshot, err := netinfo.ParseLinuxSnapshot(addresses, routes, resolv, dev)
		if err == nil {
			c.record(host.ID, snapshot.Stats)
		}
	}
}

func (c *Collector) Record(hostID int, stats []netinfo.NetStat) { c.record(hostID, stats) }

func (c *Collector) record(hostID int, stats []netinfo.NetStat) {
	now := time.Now().UnixMilli()
	cutoff := now - retention.Milliseconds()
	c.mu.Lock()
	defer c.mu.Unlock()
	newSamples := make([]Sample, 0, len(stats))
	for _, stat := range stats {
		sample := Sample{Timestamp: now, HostID: hostID, Interface: stat.Interface, RxBytes: stat.RxBytes, TxBytes: stat.TxBytes}
		if previous, ok := c.previous[key(hostID, stat.Interface)]; ok && now > previous.Timestamp {
			seconds := float64(now-previous.Timestamp) / 1000
			if sample.RxBytes >= previous.RxBytes {
				sample.RxSec = float64(sample.RxBytes-previous.RxBytes) / seconds
			}
			if sample.TxBytes >= previous.TxBytes {
				sample.TxSec = float64(sample.TxBytes-previous.TxBytes) / seconds
			}
		}
		c.previous[key(hostID, stat.Interface)] = sample
		newSamples = append(newSamples, sample)
	}
	first := sort.Search(len(c.samples), func(i int) bool { return c.samples[i].Timestamp >= cutoff })
	if first > 0 {
		c.samples = append([]Sample(nil), c.samples[first:]...)
	}
	c.samples = append(c.samples, newSamples...)
	f, err := os.OpenFile(c.file, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err == nil {
		encoder := json.NewEncoder(f)
		for _, sample := range newSamples {
			_ = encoder.Encode(sample)
		}
		_ = f.Close()
	}
	if first > 0 {
		_ = c.rewriteLocked()
	}
}

func (c *Collector) rewrite() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.rewriteLocked()
}

func (c *Collector) rewriteLocked() error {
	tmp := c.file + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(f)
	for _, sample := range c.samples {
		if err := encoder.Encode(sample); err != nil {
			_ = f.Close()
			_ = os.Remove(tmp)
			return err
		}
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, c.file)
}

func periodDuration(period string) time.Duration {
	switch period {
	case "1h":
		return time.Hour
	case "7d":
		return 7 * 24 * time.Hour
	default:
		return 24 * time.Hour
	}
}

// History returns the traffic series and per-interface totals for hostID
// over period. When iface is empty (the dashboard's default "all
// interfaces" view), the series is aggregated by collection timestamp:
// every interface recorded in the same tick shares an identical Timestamp
// (see record), so summing per-tick both fixes the series — raw
// per-interface points would otherwise interleave a loopback's near-zero
// traffic with a real NIC's into one meaningless jagged line — and bounds
// its size to one point per collection interval regardless of how many
// interfaces the host reports. A 7-day series across 5 interfaces
// (loopback + a NIC + a few docker/veth interfaces is a common count on a
// home server) was previously ~50k raw points fed straight into the chart,
// enough to hang or crash the tab on mobile; this caps it at <=10,080.
func (c *Collector) History(hostID int, iface, period string) ([]SeriesPoint, []Total) {
	cutoff := time.Now().Add(-periodDuration(period)).UnixMilli()
	c.mu.RLock()
	defer c.mu.RUnlock()

	totals := map[string]*Total{}
	previousTimestamp := map[string]int64{}
	aggregated := map[int64]*SeriesPoint{}
	var order []int64
	var series []SeriesPoint

	for _, sample := range c.samples {
		if sample.HostID != hostID || sample.Timestamp < cutoff || iface != "" && sample.Interface != iface {
			continue
		}
		total := totals[sample.Interface]
		if total == nil {
			total = &Total{Interface: sample.Interface}
			totals[sample.Interface] = total
		}
		if previous, ok := previousTimestamp[sample.Interface]; ok && sample.Timestamp > previous {
			seconds := float64(sample.Timestamp-previous) / 1000
			total.Download += uint64(sample.RxSec * seconds)
			total.Upload += uint64(sample.TxSec * seconds)
		}
		previousTimestamp[sample.Interface] = sample.Timestamp

		if iface != "" {
			series = append(series, SeriesPoint{Timestamp: sample.Timestamp, RxSec: sample.RxSec, TxSec: sample.TxSec})
			continue
		}
		point := aggregated[sample.Timestamp]
		if point == nil {
			point = &SeriesPoint{Timestamp: sample.Timestamp}
			aggregated[sample.Timestamp] = point
			order = append(order, sample.Timestamp)
		}
		point.RxSec += sample.RxSec
		point.TxSec += sample.TxSec
	}

	if iface == "" {
		sort.Slice(order, func(i, j int) bool { return order[i] < order[j] })
		series = make([]SeriesPoint, 0, len(order))
		for _, ts := range order {
			series = append(series, *aggregated[ts])
		}
	} else if series == nil {
		series = make([]SeriesPoint, 0)
	}

	outTotals := make([]Total, 0, len(totals))
	for _, total := range totals {
		outTotals = append(outTotals, *total)
	}
	sort.Slice(outTotals, func(i, j int) bool { return outTotals[i].Interface < outTotals[j].Interface })
	return series, outTotals
}

var _ = response{}
