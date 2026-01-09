// Historical graphs
let cpuChart = null;
let memoryChart = null;

async function loadGraphs() {
    try {
        const [cpuData, memData] = await Promise.all([
            api('/metrics/cpu'),
            api('/metrics/memory')
        ]);

        renderCpuChart(cpuData.data);
        renderMemoryChart(memData.data);
    } catch (err) {
        console.error("Graphs error:", err);
    }
}

function renderCpuChart(data) {
    const ctx = document.getElementById('cpu-chart');
    if (!ctx) return;

    const labels = data.map(d => new Date(d.timestamp).toLocaleTimeString());
    const values = data.map(d => d.value);

    if (cpuChart) cpuChart.destroy();

    cpuChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'CPU %',
                data: values,
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, max: 100 }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function renderMemoryChart(data) {
    const ctx = document.getElementById('memory-chart');
    if (!ctx) return;

    const labels = data.map(d => new Date(d.timestamp).toLocaleTimeString());
    const values = data.map(d => d.value);

    if (memoryChart) memoryChart.destroy();

    memoryChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Memory %',
                data: values,
                borderColor: 'rgb(34, 197, 94)',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, max: 100 }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// Auto-refresh graphs every 60 seconds
setInterval(() => {
    const dashboardPage = document.getElementById('page-dashboard');
    if (dashboardPage && !dashboardPage.classList.contains('hidden')) {
        loadGraphs();
    }
}, 60000);
