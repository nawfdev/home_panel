// Logs page
let currentLogSource = null;
let currentLogTarget = null;

async function loadLogsPage() {
    try {
        const data = await api("/logs/sources");
        const sourceSelect = document.getElementById("log-source");

        sourceSelect.innerHTML = '<option value="">Select source...</option>';
        data.sources.forEach(source => {
            if (source.id === "panel" || source.available) {
                sourceSelect.innerHTML += `<option value="${source.id}">${source.name}</option>`;
            }
        });
    } catch (err) {
        console.error("Logs page error:", err);
    }
}

async function loadLogTargets(sourceId) {
    const targetSelect = document.getElementById("log-target");

    if (sourceId === "panel") {
        targetSelect.disabled = true;
        targetSelect.innerHTML = '<option value="">N/A</option>';
        return;
    }

    try {
        const data = await api(`/logs/sources/${sourceId}/targets`);
        targetSelect.disabled = false;
        targetSelect.innerHTML = '<option value="">Select target...</option>';
        data.targets.forEach(target => {
            targetSelect.innerHTML += `<option value="${target.id}">${target.name}</option>`;
        });
    } catch (err) {
        targetSelect.innerHTML = '<option value="">Error loading targets</option>';
    }
}

async function loadLogs() {
    const sourceId = document.getElementById("log-source").value;
    const target = document.getElementById("log-target").value;
    const lines = document.getElementById("log-lines").value;
    const search = document.getElementById("log-search").value;

    if (!sourceId) {
        document.getElementById("logs-content").textContent = "Select a log source";
        return;
    }

    if (sourceId !== "panel" && !target) {
        document.getElementById("logs-content").textContent = "Select a target";
        return;
    }

    try {
        let url = `/logs/sources/${sourceId}?lines=${lines}`;
        if (target) url += `&target=${target}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;

        const data = await api(url);
        document.getElementById("logs-content").textContent = data.logs || "No logs available";
    } catch (err) {
        document.getElementById("logs-content").textContent = `Error: ${err.message}`;
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    const sourceSelect = document.getElementById("log-source");
    const targetSelect = document.getElementById("log-target");
    const linesSelect = document.getElementById("log-lines");
    const searchInput = document.getElementById("log-search");
    const refreshBtn = document.getElementById("refresh-logs-btn");

    if (sourceSelect) {
        sourceSelect.addEventListener("change", async () => {
            currentLogSource = sourceSelect.value;
            if (currentLogSource) {
                await loadLogTargets(currentLogSource);
                if (currentLogSource === "panel") {
                    await loadLogs();
                }
            }
        });
    }

    if (targetSelect) {
        targetSelect.addEventListener("change", () => {
            currentLogTarget = targetSelect.value;
            if (currentLogTarget) loadLogs();
        });
    }

    if (linesSelect) {
        linesSelect.addEventListener("change", loadLogs);
    }

    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener("input", () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(loadLogs, 500);
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon.classList.add("fa-spin");
            await loadLogs();
            setTimeout(() => icon.classList.remove("fa-spin"), 500);
        });
    }
});
