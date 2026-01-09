// Services page
async function loadServicesPage() {
    try {
        const data = await api("/services");

        if (data.platform === 'windows') {
            document.getElementById("services-status").innerHTML = `
        <div class="bg-blue-900 border border-blue-700 rounded-lg p-4">
          <div class="flex items-center">
            <i class="fas fa-info-circle text-blue-400 text-xl mr-3"></i>
            <div>
              <h4 class="font-bold text-blue-300">Windows Services</h4>
              <p class="text-sm text-blue-200">${data.services.length} services found</p>
            </div>
          </div>
        </div>
      `;
        }

        if (data.services && data.services.length > 0) {
            document.getElementById("services-list").innerHTML = data.services.map(service => {
                const isRunning = service.status === 'running';
                return `
          <div class="bg-gray-700 rounded-lg p-3 flex items-center justify-between">
            <div class="flex items-center">
              <i class="fas fa-circle text-${isRunning ? 'green' : 'red'}-500 mr-3"></i>
              <div>
                <h4 class="font-bold">${service.name}</h4>
                <p class="text-xs text-gray-400 capitalize">${service.status}</p>
              </div>
            </div>
            <div class="flex gap-2">
              ${!isRunning ? `
                <button onclick="serviceAction('${service.name}', 'start')" class="bg-green-600 hover:bg-green-700 px-3 py-1 rounded text-sm">
                  <i class="fas fa-play mr-1"></i>Start
                </button>
              ` : `
                <button onclick="serviceAction('${service.name}', 'stop')" class="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-sm">
                  <i class="fas fa-stop mr-1"></i>Stop
                </button>
              `}
            </div>
          </div>
        `;
            }).join('');
        } else {
            document.getElementById("services-list").innerHTML = `<p class="text-gray-400">No services found or not supported on this platform</p>`;
        }
    } catch (err) {
        console.error("Services error:", err);
        document.getElementById("services-status").innerHTML = `
      <div class="bg-red-900 border border-red-700 rounded-lg p-4">
        <p class="text-red-300">Error loading services: ${err.message}</p>
      </div>
    `;
    }
}

async function serviceAction(name, action) {
    try {
        await api(`/services/${name}/${action}`, { method: 'POST' });
        await loadServicesPage();
    } catch (err) {
        alert(`Failed to ${action} service: ${err.message}`);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById("refresh-services-btn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon.classList.add("fa-spin");
            await loadServicesPage();
            setTimeout(() => icon.classList.remove("fa-spin"), 500);
        });
    }
});
