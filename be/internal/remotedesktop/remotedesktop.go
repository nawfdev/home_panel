// Package remotedesktop manages saved remoteagent peers so the panel can
// hand off keyboard/mouse control of a LAN device: the browser connects
// straight to the agent's WebSocket with the stored host/port/token, no
// protocol relay through this backend.
package remotedesktop

import "github.com/nawfdev/home-panel/internal/store"

type Manager struct {
	store *store.Store
}

func New(s *store.Store) *Manager { return &Manager{store: s} }

func (m *Manager) GetAll() []store.RemoteDevice { return m.store.ListRemoteDevices() }

func (m *Manager) Get(id int) (store.RemoteDevice, bool) { return m.store.GetRemoteDevice(id) }

func (m *Manager) Add(name, host string, port int, token, notes string) (store.RemoteDevice, error) {
	id, err := m.store.InsertRemoteDevice(store.RemoteDevice{
		Name: name, Host: host, Port: port, Token: token, Notes: notes,
	})
	if err != nil {
		return store.RemoteDevice{}, err
	}
	d, _ := m.store.GetRemoteDevice(id)
	return d, nil
}

// Update applies a partial JSON body (name/host/port/token/notes).
func (m *Manager) Update(id int, body map[string]interface{}) (store.RemoteDevice, bool) {
	m.store.UpdateRemoteDevice(id, func(d *store.RemoteDevice) {
		if v, ok := body["name"].(string); ok {
			d.Name = v
		}
		if v, ok := body["host"].(string); ok {
			d.Host = v
		}
		if v, ok := body["port"].(float64); ok {
			d.Port = int(v)
		}
		if v, ok := body["token"].(string); ok {
			d.Token = v
		}
		if v, ok := body["notes"].(string); ok {
			d.Notes = v
		}
	})
	return m.store.GetRemoteDevice(id)
}

func (m *Manager) Delete(id int) error { return m.store.DeleteRemoteDevice(id) }
