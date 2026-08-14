import { useEffect, useState } from "react";
import { PlusIcon, ServerIcon, TrashIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import { Modal } from "../components/ui/Modal";
import { Panel } from "../components/ui/Panel";
import { useToast } from "../context/ToastContext";
import { api } from "../lib/api";
import type { Host } from "../lib/hosts";

const emptyForm = { name: "", address: "", port: "22", user: "", password: "" };

export function Hosts() {
  const { show } = useToast();
  const [hosts, setHosts] = useState<Host[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Host | null>(null);

  // Edit Host State
  const [editTarget, setEditTarget] = useState<Host | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [updating, setUpdating] = useState(false);

  async function load() {
    try {
      setHosts(await api<Host[]>("/hosts"));
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load hosts", "error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openAdd() {
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(host: Host) {
    setEditTarget(host);
    setEditForm({
      name: host.name,
      address: host.address,
      port: String(host.port),
      user: host.user,
      password: "",
    });
  }

  async function saveEdit() {
    if (!editTarget) return;
    const port = Number(editForm.port);
    if (!editForm.name.trim() || !editForm.address.trim() || !editForm.user.trim()) {
      show("Name, address, and user are required", "warning");
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      show("Port must be between 1 and 65535", "warning");
      return;
    }

    setUpdating(true);
    try {
      const payload: {
        name: string;
        address: string;
        port: number;
        user: string;
        password?: string;
      } = {
        name: editForm.name.trim(),
        address: editForm.address.trim(),
        port,
        user: editForm.user.trim(),
      };

      if (editForm.password.trim()) {
        payload.password = editForm.password;
      }

      await api<Host>(`/hosts/${editTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      show("Host updated successfully", "success");
      setEditTarget(null);
      await load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to update host", "error");
    } finally {
      setUpdating(false);
    }
  }

  async function addHost() {
    const port = Number(form.port);
    if (!form.name.trim() || !form.address.trim() || !form.user.trim() || !form.password) {
      show("Name, address, user, and password are required", "warning");
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      show("Port must be between 1 and 65535", "warning");
      return;
    }

    setSaving(true);
    try {
      await api<Host>("/hosts", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          address: form.address.trim(),
          port,
          user: form.user.trim(),
          password: form.password,
        }),
      });
      setFormOpen(false);
      setForm(emptyForm);
      show("Host added and SSH key installed", "success");
      await load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to add host", "error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteHost() {
    if (!deleteTarget) return;
    try {
      await api(`/hosts/${deleteTarget.id}`, { method: "DELETE" });
      show("Host removed", "success");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to remove host", "error");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Hosts</h2>
          <p className="text-gray-500 text-sm mt-1">SSH targets available in Terminal and Files</p>
        </div>
        <button className="btn-primary shrink-0" onClick={openAdd}>
          <PlusIcon className="w-4 h-4 inline mr-1.5" />Add host
        </button>
      </div>

      <Panel title={`Remote hosts${hosts ? ` (${hosts.length})` : ""}`}>
        {hosts === null ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : hosts.length === 0 ? (
          <p className="text-sm text-gray-500">No remote hosts yet. Add a Linux host reachable over SSH.</p>
        ) : (
          <div className="space-y-3">
            {hosts.map((host) => (
              <div key={host.id} className="bg-white/5 rounded-lg p-4 flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-3">
                  <ServerIcon className="w-5 h-5 text-gray-500 shrink-0" />
                  <div className="min-w-0">
                    <button
                      onClick={() => openEdit(host)}
                      className="font-semibold text-sm text-gray-100 truncate hover:text-blue-400 transition-colors flex items-center gap-1.5 cursor-pointer text-left"
                      title="Click to edit host details"
                    >
                      <span>{host.name}</span>
                      <PencilSquareIcon className="w-3.5 h-3.5 text-gray-500 hover:text-blue-400 transition-colors" />
                    </button>
                    <p className="text-xs text-gray-500 font-mono truncate">
                      {host.user}@{host.address}:{host.port}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="btn-secondary text-xs !py-1.5 !px-3" onClick={() => openEdit(host)} title="Edit host details">
                    <PencilSquareIcon className="w-4 h-4 inline mr-1" />Edit
                  </button>
                  <button className="btn-danger text-xs !py-1.5 !px-3" onClick={() => setDeleteTarget(host)}>
                    <TrashIcon className="w-4 h-4 inline mr-1" />Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Add Host Modal */}
      {formOpen && (
        <Modal title="Add SSH host" onClose={() => !saving && setFormOpen(false)}>
          <p className="text-xs text-gray-500 mb-4">
            The password is used once to install Nestcore's SSH key, then discarded.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="input-field w-full"
                placeholder="Living room STB"
                disabled={saving}
              />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Address</label>
              <input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className="input-field w-full font-mono"
                placeholder="192.168.1.50"
                disabled={saving}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-500 text-xs mb-1.5">SSH port</label>
                <input
                  value={form.port}
                  onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                  className="input-field w-full font-mono"
                  inputMode="numeric"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-gray-500 text-xs mb-1.5">User</label>
                <input
                  value={form.user}
                  onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
                  className="input-field w-full font-mono"
                  placeholder="root"
                  disabled={saving}
                />
              </div>
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="input-field w-full"
                autoComplete="new-password"
                disabled={saving}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button className="btn-primary flex-1 disabled:opacity-60" onClick={addHost} disabled={saving}>
              {saving ? "Installing key..." : "Add host"}
            </button>
            <button className="btn-secondary flex-1" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* Edit Host Modal */}
      {editTarget && (
        <Modal title={`Edit host: ${editTarget.name}`} onClose={() => !updating && setEditTarget(null)}>
          <p className="text-xs text-gray-500 mb-4">
            Update host details. Password is only needed if you want to reinstall or update Nestcore's SSH key.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Name</label>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="input-field w-full"
                placeholder="STB living room"
                disabled={updating}
              />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Address (IP / Hostname)</label>
              <input
                value={editForm.address}
                onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                className="input-field w-full font-mono"
                placeholder="192.168.1.50"
                disabled={updating}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-500 text-xs mb-1.5">SSH port</label>
                <input
                  value={editForm.port}
                  onChange={(e) => setEditForm((f) => ({ ...f, port: e.target.value }))}
                  className="input-field w-full font-mono"
                  inputMode="numeric"
                  disabled={updating}
                />
              </div>
              <div>
                <label className="block text-gray-500 text-xs mb-1.5">User</label>
                <input
                  value={editForm.user}
                  onChange={(e) => setEditForm((f) => ({ ...f, user: e.target.value }))}
                  className="input-field w-full font-mono"
                  placeholder="root"
                  disabled={updating}
                />
              </div>
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">
                New password <span className="text-gray-600">(optional, to reinstall SSH key)</span>
              </label>
              <input
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                className="input-field w-full"
                placeholder="Leave blank to keep existing key"
                autoComplete="new-password"
                disabled={updating}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button className="btn-primary flex-1 disabled:opacity-60" onClick={saveEdit} disabled={updating}>
              {updating ? "Saving changes..." : "Save changes"}
            </button>
            <button className="btn-secondary flex-1" onClick={() => setEditTarget(null)} disabled={updating}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* Delete Host Modal */}
      {deleteTarget && (
        <Modal title="Remove host" onClose={() => setDeleteTarget(null)}>
          <p className="text-sm text-gray-300">
            Remove <span className="font-semibold text-gray-100">{deleteTarget.name}</span> from Nestcore? The installed
            public key remains on the host.
          </p>
          <div className="flex gap-2 mt-5">
            <button className="btn-danger flex-1" onClick={deleteHost}>Remove</button>
            <button className="btn-secondary flex-1" onClick={() => setDeleteTarget(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
