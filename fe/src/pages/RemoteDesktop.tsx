import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import { PlusIcon, TrashIcon, PencilIcon, ComputerDesktopIcon } from "@heroicons/react/24/outline";

interface Device {
  id: number;
  name: string;
  rustdesk_id: string;
  server?: string;
  key?: string;
  notes?: string;
}

const emptyForm = { name: "", rustdesk_id: "", server: "", key: "", notes: "" };

export function RemoteDesktop() {
  const { show } = useToast();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Device | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const data = await api<Device[]>("/remote-desktop");
      setDevices(data);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load devices", "error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(d: Device) {
    setEditing(d);
    setForm({ name: d.name, rustdesk_id: d.rustdesk_id, server: d.server ?? "", key: d.key ?? "", notes: d.notes ?? "" });
    setFormOpen(true);
  }

  async function save() {
    if (!form.name || !form.rustdesk_id) {
      show("Name and RustDesk ID are required", "warning");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api(`/remote-desktop/${editing.id}`, { method: "PUT", body: JSON.stringify(form) });
        show("Device updated", "success");
      } else {
        await api("/remote-desktop", { method: "POST", body: JSON.stringify(form) });
        show("Device added", "success");
      }
      setFormOpen(false);
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save device", "error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteDevice() {
    if (!deleteTarget) return;
    try {
      await api(`/remote-desktop/${deleteTarget.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to delete device", "error");
    } finally {
      setDeleteTarget(null);
    }
  }

  function connectUri(d: Device) {
    if (!d.server) return `rustdesk://${d.rustdesk_id}`;
    const params = new URLSearchParams({ server: d.server });
    if (d.key) params.set("key", d.key);
    return `rustdesk://${d.rustdesk_id}?${params.toString()}`;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Remote Desktop</h2>
          <p className="text-gray-500 text-sm mt-1">
            Control a LAN device's mouse and keyboard via a self-hosted RustDesk relay
          </p>
        </div>
        <button className="btn-primary" onClick={openAdd}>
          <PlusIcon className="w-4 h-4 inline mr-1.5" />Add device
        </button>
      </div>

      <Panel title={`Devices${devices ? ` (${devices.length})` : ""}`}>
        {devices === null ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-gray-500">
            No devices yet. Install RustDesk on the target machine, set a permanent password, then add it here.
          </p>
        ) : (
          <div className="space-y-3">
            {devices.map((d) => (
              <div key={d.id} className="bg-white/5 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2 gap-3">
                  <div className="min-w-0 flex items-center gap-2">
                    <ComputerDesktopIcon className="w-4 h-4 text-gray-500 shrink-0" />
                    <p className="font-semibold text-sm text-gray-100 truncate">{d.name}</p>
                  </div>
                  <span className="status-badge shrink-0 bg-white/10 text-gray-400 font-mono">{d.rustdesk_id}</span>
                </div>
                {(d.server || d.notes) && (
                  <div className="flex gap-3 text-xs text-gray-500 mb-3">
                    {d.server && <span className="font-mono">{d.server}</span>}
                    {d.notes && <span className="truncate">{d.notes}</span>}
                  </div>
                )}
                <div className="flex gap-2 flex-wrap">
                  <a href={connectUri(d)} className="btn-primary">
                    <ComputerDesktopIcon className="w-4 h-4 inline mr-1.5" />Connect
                  </a>
                  <button className="btn-secondary" onClick={() => openEdit(d)}>
                    <PencilIcon className="w-4 h-4 inline mr-1.5" />Edit
                  </button>
                  <button className="btn-danger" onClick={() => setDeleteTarget(d)}>
                    <TrashIcon className="w-4 h-4 inline mr-1.5" />Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {formOpen && (
        <Modal title={editing ? "Edit device" : "Add device"} onClose={() => setFormOpen(false)}>
          <div className="space-y-3">
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="input-field w-full"
                placeholder="My laptop"
              />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">RustDesk ID</label>
              <input
                value={form.rustdesk_id}
                onChange={(e) => setForm((f) => ({ ...f, rustdesk_id: e.target.value }))}
                className="input-field w-full font-mono"
                placeholder="123456789"
              />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Self-hosted server (optional)</label>
              <input
                value={form.server}
                onChange={(e) => setForm((f) => ({ ...f, server: e.target.value }))}
                className="input-field w-full font-mono"
                placeholder="192.168.1.10:21116"
              />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Server key (optional)</label>
              <input
                value={form.key}
                onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                className="input-field w-full font-mono"
                placeholder="hbbs public key"
              />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Notes (optional)</label>
              <input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="input-field w-full"
                placeholder="Password stays in RustDesk, not stored here"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button className="btn-primary flex-1 disabled:opacity-60" onClick={save} disabled={saving}>
              {saving ? "Saving..." : editing ? "Save" : "Add"}
            </button>
            <button className="btn-secondary flex-1" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Delete device" onClose={() => setDeleteTarget(null)}>
          <p className="text-sm text-gray-300">
            Delete device <span className="font-semibold text-gray-100">{deleteTarget.name}</span>?
          </p>
          <div className="flex gap-2 mt-5">
            <button className="btn-danger flex-1" onClick={deleteDevice}>
              Delete
            </button>
            <button className="btn-secondary flex-1" onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
