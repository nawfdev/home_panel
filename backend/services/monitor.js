const si = require("systeminformation");
const os = require("os");
const fs = require("fs");

async function getSystemStats() {
  try {
    const [cpu, mem, disk, osInfo, time, networkStats, processes, battery] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.osInfo(),
      si.time(),
      si.networkStats(),
      si.processes(),
      si.battery()
    ]);

    return {
      cpu: {
        usage: Math.round(cpu.currentLoad * 100) / 100,
        cores: cpu.cpus ? cpu.cpus.length : 0
      },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        usagePercent: Math.round((mem.used / mem.total) * 100 * 100) / 100
      },
      disk: disk.map(d => ({
        fs: d.fs,
        type: d.type,
        size: d.size,
        used: d.used,
        available: d.available,
        usagePercent: Math.round(d.use * 100) / 100,
        mount: d.mount
      })),
      os: {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        hostname: osInfo.hostname,
        arch: osInfo.arch
      },
      uptime: time.uptime,
      network: networkStats.map(n => ({
        iface: n.iface,
        rx_bytes: n.rx_bytes,
        tx_bytes: n.tx_bytes,
        rx_sec: n.rx_sec,
        tx_sec: n.tx_sec
      })),
      processes: {
        all: processes.all,
        running: processes.running,
        blocked: processes.blocked,
        sleeping: processes.sleeping
      },
      battery: {
        hasBattery: battery.hasBattery || false,
        percent: battery.percent || 0,
        isCharging: battery.isCharging || false,
        acConnected: battery.acConnected || false
      }
    };
  } catch (error) {
    console.error("Error getting system stats:", error);
    throw error;
  }
}

async function getProcessList() {
  try {
    const processes = await si.processes();
    return processes.list
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 20)
      .map(p => ({
        pid: p.pid,
        name: p.name,
        cpu: Math.round(p.cpu * 100) / 100,
        mem: Math.round(p.mem * 100) / 100,
        state: p.state
      }));
  } catch (error) {
    console.error("Error getting process list:", error);
    throw error;
  }
}

async function getTemperature() {
  try {
    const temp = await si.cpuTemperature();

    // If systeminformation works, use it
    if (temp.main !== null && temp.main !== -1 && temp.main > 0) {
      return {
        main: temp.main,
        cores: temp.cores || [],
        max: temp.max || null,
        available: true
      };
    }

    // Linux fallback: read from /sys/class/thermal/
    if (os.platform() === 'linux') {
      try {
        const thermalZones = [
          '/sys/class/thermal/thermal_zone0/temp',
          '/sys/class/thermal/thermal_zone1/temp',
          '/sys/class/hwmon/hwmon0/temp1_input',
          '/sys/class/hwmon/hwmon1/temp1_input'
        ];

        for (const zone of thermalZones) {
          try {
            const data = fs.readFileSync(zone, 'utf8');
            const tempValue = parseInt(data.trim()) / 1000; // Convert millidegrees to degrees
            if (tempValue > 0 && tempValue < 150) { // Sanity check
              return {
                main: Math.round(tempValue),
                cores: [],
                max: null,
                available: true,
                source: 'sysfs'
              };
            }
          } catch {
            // Try next zone
          }
        }
      } catch {
        // Fallback failed
      }
    }

    return {
      main: null,
      cores: [],
      max: null,
      available: false
    };
  } catch (error) {
    console.error("Error getting temperature:", error);
    return {
      main: null,
      cores: [],
      max: null,
      available: false
    };
  }
}

module.exports = { getSystemStats, getProcessList, getTemperature };

