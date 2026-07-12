package handlers

import (
	"net/http"

	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/metrics"
)

// Metrics ports backend/routes/metrics.js. All routes return historical series
// (the Node temperature route also returns history, not a live reading).
type Metrics struct {
	Collector *metrics.Collector
}

func (m *Metrics) CPU(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "data": m.Collector.Historical("cpu")})
}

func (m *Metrics) Memory(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "data": m.Collector.Historical("memory")})
}

func (m *Metrics) Network(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"rx": m.Collector.Historical("network_rx"),
			"tx": m.Collector.Historical("network_tx"),
		},
	})
}

func (m *Metrics) Temperature(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "data": m.Collector.Historical("temperature")})
}
