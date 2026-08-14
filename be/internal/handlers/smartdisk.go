package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/smartdisk"
)

type Storage struct {
	Svc *smartdisk.Service
}

func (s *Storage) Disks(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	id, err := hostID(r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}

	overview, err := s.Svc.GetOverview(ctx, id)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}

	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success":  true,
		"overview": overview,
	})
}
