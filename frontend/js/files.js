// File Browser
let currentPath = '/';

async function loadFilesPage() {
    await loadDirectory(currentPath);
}

async function loadDirectory(path) {
    try {
        const data = await api('/files/list', { method: 'POST', body: JSON.stringify({ path }) });
        currentPath = data.path;

        document.getElementById('current-path').textContent = currentPath || '/';

        const filesList = document.getElementById('files-list');
        filesList.innerHTML = data.items.map(item => `
      <div class="bg-gray-700 rounded-lg p-3 flex items-center justify-between hover:bg-gray-600 transition">
        <div class="flex items-center gap-3 flex-1 cursor-pointer" onclick="handleFileClick('${item.path}', ${item.isDirectory})">
          <i class="fas fa-${item.isDirectory ? 'folder text-yellow-500' : 'file text-gray-400'} text-xl"></i>
          <div>
            <h4 class="font-bold">${item.name}</h4>
            ${!item.isDirectory ? `<p class="text-xs text-gray-400">${formatBytes(item.size)}</p>` : ''}
          </div>
        </div>
        <div class="flex gap-2">
          ${!item.isDirectory ? `
            <button onclick="downloadFile('${item.path}')" class="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm">
              <i class="fas fa-download"></i>
            </button>
          ` : ''}
          <button onclick="deleteItem('${item.path}')" class="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-sm">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `).join('');
    } catch (err) {
        console.error('Files error:', err);
        alert('Error loading directory: ' + err.message);
    }
}

function handleFileClick(path, isDirectory) {
    if (isDirectory) {
        loadDirectory(path);
    } else {
        viewFile(path);
    }
}

async function viewFile(path) {
    try {
        const data = await api('/files/read', { method: 'POST', body: JSON.stringify({ path }) });

        document.getElementById('file-editor-path').textContent = path;
        document.getElementById('file-content').value = data.content;
        document.getElementById('file-editor-modal').classList.remove('hidden');
    } catch (err) {
        alert('Error opening file: ' + err.message);
    }
}

async function saveFile() {
    try {
        const path = document.getElementById('file-editor-path').textContent;
        const content = document.getElementById('file-content').value;

        await api('/files/write', { method: 'POST', body: JSON.stringify({ path, content }) });
        alert('File saved!');
        closeFileEditor();
        loadDirectory(currentPath);
    } catch (err) {
        alert('Error saving file: ' + err.message);
    }
}

function closeFileEditor() {
    document.getElementById('file-editor-modal').classList.add('hidden');
}

async function deleteItem(path) {
    showConfirm(`Delete ${path}?`, async () => {
        try {
            await api('/files/delete', { method: 'POST', body: JSON.stringify({ path }) });
            loadDirectory(currentPath);
        } catch (err) {
            alert('Error deleting: ' + err.message);
        }
    });
}

function downloadFile(path) {
    window.location.href = `/api/files/download?path=${encodeURIComponent(path)}`;
}

function goUpDirectory() {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    loadDirectory('/' + parts.join('/'));
}

function openUploadModal() {
    document.getElementById('upload-path').textContent = currentPath;
    document.getElementById('upload-modal').classList.remove('hidden');
}

function closeUploadModal() {
    document.getElementById('upload-modal').classList.add('hidden');
    document.getElementById('file-input').value = '';
}

async function handleUpload(e) {
    e.preventDefault();

    const fileInput = document.getElementById('file-input');
    const file = fileInput.files[0];

    if (!file) {
        alert('Please select a file');
        return;
    }

    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', currentPath);

        const res = await fetch('/api/files/upload', {
            method: 'POST',
            body: formData,
            credentials: 'include'
        });

        const data = await res.json();

        if (data.success) {
            alert('File uploaded successfully!');
            closeUploadModal();
            loadDirectory(currentPath);
        } else {
            alert('Upload failed: ' + data.error);
        }
    } catch (err) {
        alert('Upload error: ' + err.message);
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('up-dir-btn')?.addEventListener('click', goUpDirectory);
    document.getElementById('upload-file-btn')?.addEventListener('click', openUploadModal);
    document.getElementById('close-upload-btn')?.addEventListener('click', closeUploadModal);
    document.getElementById('save-file-btn')?.addEventListener('click', saveFile);
    document.getElementById('close-editor-btn')?.addEventListener('click', closeFileEditor);
    document.getElementById('upload-form')?.addEventListener('submit', handleUpload);
});
