// Package remotedesktop manages saved RustDesk peers so the panel can hand
// off keyboard/mouse control of a LAN device without embedding a remote
// desktop protocol itself — it just launches the operator's local RustDesk
// client via the rustdesk:// URI scheme with the right ID/server prefilled.
package remotedesktop

import "github.com/nawfdev/home-panel/internal/store"

type Manager struct {
	store *store.Store
}

func New(s *store.Store) *Manager { return &Manager{store: s} }

func (m *Manager) GetAll() []store.RemoteDevice { return m.store.ListRemoteDevices() }

func (m *Manager) Get(id int) (store.RemoteDevice, bool) { return m.store.GetRemoteDevice(id) }

func (m *Manager) Add(name, rustdeskID, server, key, notes string) (store.RemoteDevice, error) {
	id, err := m.store.InsertRemoteDevice(store.RemoteDevice{
		Name: name, RustdeskID: rustdeskID, Server: server, Key: key, Notes: notes,
	})
	if err != nil {
		return store.RemoteDevice{}, err
	}
	d, _ := m.store.GetRemoteDevice(id)
	return d, nil
}

// Update applies a partial JSON body (name/rustdesk_id/server/key/notes).
func (m *Manager) Update(id int, body map[string]interface{}) (store.RemoteDevice, bool) {
	m.store.UpdateRemoteDevice(id, func(d *store.RemoteDevice) {
		if v, ok := body["name"].(string); ok {
			d.Name = v
		}
		if v, ok := body["rustdesk_id"].(string); ok {
			d.RustdeskID = v
		}
		if v, ok := body["server"].(string); ok {
			d.Server = v
		}
		if v, ok := body["key"].(string); ok {
			d.Key = v
		}
		if v, ok := body["notes"].(string); ok {
			d.Notes = v
		}
	})
	return m.store.GetRemoteDevice(id)
}

func (m *Manager) Delete(id int) error { return m.store.DeleteRemoteDevice(id) }
