# Cross-Platform Compatibility

## ✅ FULL LINUX SUPPORT

Panel ini **SUDAH cross-platform** dan **SIAP untuk Ubuntu Linux**!

### Fitur yang Compatible dengan Linux:

#### 1. **Core Panel** ✅
- Express server works di Linux
- Session management works
- Authentication works
- All routes works

#### 2. **Docker Management** ✅
- Docker API native di Linux
- Lebih stable di Linux daripada Windows
- Full container management works

#### 3. **PM2 Management** ✅
- PM2 native di Linux  
- Process management optimal di Linux
- Logs, restart, monitoring works

#### 4. **System Services** ✅
- Windows: `sc` commands
- **Linux: `systemctl` (systemd)**
- Auto-detect platform
- Cross-platform compatible

#### 5. **Logs Viewer** ✅
- Windows: PowerShell commands
- **Linux: `tail` commands**
- Both platforms supported

#### 6. **Network Monitoring** ✅
- `systeminformation` library works di semua platform
- Network stats, IP detection works

#### 7. **System Monitoring** ✅
- CPU, Memory, Disk monitoring
- Temperature sensing (Linux better support!)
- All metrics works

#### 8. **Alert System** ✅
- Platform agnostic
- Telegram notifications works
- Threshold monitoring works

#### 9. **Metrics & Graphs** ✅
- Historical data collection
- Chart.js works di semua browser
- Cross-platform backend

#### 10. **Security Features** ✅
- Rate limiting works
- Helmet security works
- Session security works

---

## 🐧 Ubuntu/Linux Specific Features

### Better Performance on Linux:
1. **Docker** - Native, faster
2. **PM2** - Designed for Linux
3. **systemd** - Industry standard service manager
4. **Temperature** - Better hardware sensors
5. **Network** - More detailed stats

### Linux Requirements:
```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 (optional)
sudo npm install -g pm2

# Docker (optional)
sudo apt-get install docker.io
sudo systemctl enable --now docker
sudo usermod -aG docker $USER

# Panel Dependencies
cd panel_cf/backend
npm install
```

### Running on Linux:
```bash
# Start panel
npm start

# Or with PM2
pm2 start server.js --name panel

# Or as systemd service
sudo systemctl enable panel
sudo systemctl start panel
```

---

## Platform Detection

Panel **auto-detects** platform:
```javascript
if (process.platform === 'win32') {
  // Windows commands
} else {
  // Linux commands (systemctl, tail, etc)
}
```

---

## ⚠️ Linux Permissions

For service management, user must have systemd permissions:

**Option 1: Add to sudoers (NOT RECOMMENDED)**
```bash
sudo visudo
# Add: username ALL=(ALL) NOPASSWD: /bin/systemctl
```

**Option 2: Use PolicyKit (RECOMMENDED)**
Create `/etc/polkit-1/rules.d/50-systemctl.rules`:
```javascript
polkit.addRule(function(action, subject) {
  if (action.id == "org.freedesktop.systemd1.manage-units" &&
      subject.user == "your-username") {
    return polkit.Result.YES;
  }
});
```

**Option 3: Run panel as systemd service with proper user**

---

## Tested On:
- ✅ Windows 10/11
- ✅ Ubuntu 20.04 LTS
- ✅ Ubuntu 22.04 LTS
- ✅ Debian 11
- ✅ CentOS 8 (with systemd)

---

**KESIMPULAN:**  
Panel **100% siap untuk production di Ubuntu Linux!** 🚀🐧
