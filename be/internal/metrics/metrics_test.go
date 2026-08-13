package metrics

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestOpenRestoresRecentSamplesAndDropsExpiredSamples(t *testing.T) {
	t.Parallel()

	file := filepath.Join(t.TempDir(), "metrics-history.jsonl")
	f, err := os.OpenFile(file, os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	encoder := json.NewEncoder(f)
	now := time.Now()
	for _, sample := range []storedPoint{
		{Metric: "cpu", Point: Point{Timestamp: now.Add(-25 * time.Hour).UnixMilli(), Value: 99}},
		{Metric: "cpu", Point: Point{Timestamp: now.Add(-23 * time.Hour).UnixMilli(), Value: 12}},
		{Metric: "memory", Point: Point{Timestamp: now.Add(-time.Hour).UnixMilli(), Value: 34}},
	} {
		if err := encoder.Encode(sample); err != nil {
			t.Fatal(err)
		}
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	collector, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	if got := collector.Historical("cpu"); len(got) != 1 || got[0].Value != 12 {
		t.Fatalf("restored CPU samples = %#v, want one recent sample", got)
	}
	if got := collector.Historical("memory"); len(got) != 1 || got[0].Value != 34 {
		t.Fatalf("restored memory samples = %#v, want one recent sample", got)
	}

	reopened, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	if got := reopened.Historical("cpu"); len(got) != 1 || got[0].Value != 12 {
		t.Fatalf("CPU samples after restart = %#v, want persisted recent sample", got)
	}
	if got := reopened.Historical("memory"); len(got) != 1 || got[0].Value != 34 {
		t.Fatalf("memory samples after restart = %#v, want persisted recent sample", got)
	}
}

func TestPushKeepsLatest24HoursOfMinuteSamples(t *testing.T) {
	t.Parallel()

	var points []Point
	for i := 0; i < maxDataPoints+5; i++ {
		points = push(points, Point{Timestamp: int64(i), Value: float64(i)})
	}
	if len(points) != maxDataPoints {
		t.Fatalf("sample count = %d, want %d", len(points), maxDataPoints)
	}
	if points[0].Timestamp != 5 {
		t.Fatalf("oldest timestamp = %d, want 5", points[0].Timestamp)
	}
}
