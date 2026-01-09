# 🏠 Home Panel

<div align="center">

![Home Panel Logo](https://via.placeholder.com/200x200/1e293b/60a5fa?text=Home+Panel)

**Enterprise-Grade Homelab Management Dashboard**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*Beautiful • Secure • Feature-Rich • Cross-Platform*

[🚀 Quick Start](#-quick-start) • [📚 Documentation](docs/) • [🐛 Issues](https://github.com/yourusername/home-panel/issues) • [⭐ Star](https://github.com/yourusername/home-panel)

</div>

---

## ✨ What is Home Panel?

Home Panel is a **powerful, all-in-one web dashboard** for managing your homelab infrastructure. Built with **security-first** principles and designed for both **Windows and Linux** servers.

**Perfect for:**
- 🏠 Home server enthusiasts
- 💼 Small business IT
- 🧪 Development environments
- 🎓 Learning DevOps

---

## 🎯 Key Features

<table>
<tr>
<td width="50%">

### 📊 **Monitoring**
- Real-time system stats
- CPU, Memory, Disk, Network
- Temperature sensors
- Power/Battery status
- Historical graphs
- Customizable alerts

</td>
<td width="50%">

### 🐳 **Container & Process**
- Docker management
- PM2 process control
- Service manager (systemd/Windows)
- Container logs
- Resource limits
- Auto-restart policies

</td>
</tr>
<tr>
<td>

### 📁 **File Management**
- Web-based file browser
- Upload & download
- Text editor
- Delete & rename
- Safe path restrictions
- 10MB upload limit

</td>
<td>

### 💻 **Terminal**
- Browser-based shell
- Command execution
- Auto-reconnect
- Command history
- Output streaming
- Dangerous command blocking

</td>
</tr>
</table>

### 🔔 **Alerts & Notifications**
- Threshold monitoring (CPU, RAM, Disk, Temp)
- Telegram bot integration
- Automatic alerts
- Cooldown periods
- Recovery notifications

### 🔒 **Security**
- ✅ Rate limiting (API & login)
- ✅ Input validation & sanitization
- ✅ Path traversal protection
- ✅ Command injection prevention
- ✅ Session security (bcrypt)
- ✅ Audit logging
- ✅ Helmet security headers

**Security Score: 9/10** ⭐

---

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/home-panel.git
cd home-panel

# Install dependencies
cd backend
npm install

# Start the server
npm start
```

**Access:** http://localhost:3000

**Default Login:**
- Username: `admin`
- Password: `SecurePass2026!`

⚠️ **Change password immediately!**

---

## 📸 Screenshots

### Dashboard
![Dashboard](https://via.placeholder.com/800x450/1e293b/60a5fa?text=Dashboard+Screenshot)

### Docker Management
![Docker](https://via.placeholder.com/800x450/1e293b/60a5fa?text=Docker+Screenshot)

### Web Terminal
![Terminal](https://via.placeholder.com/800x450/1e293b/60a5fa?text=Terminal+Screenshot)

---

## 📚 Documentation

- [📖 Full Documentation](docs/)
- [🐧 Linux Compatibility](docs/LINUX_COMPATIBILITY.md)
- [🔐 Security Guide](docs/SECURITY_CHANGES.md)
- [📱 Telegram Setup](docs/TELEGRAM_SETUP.md)
- [⚙️ PM2 Configuration](docs/PM2_SETUP.md)
- [🔄 Auto-Restart Setup](docs/TUNNEL_AUTO_RESTART.md)

---

## ⚙️ Configuration

### Basic Setup

Edit `config/config.json`:

```json
{
  "server": { "port": 3000, "host": "0.0.0.0" },
  "session": { "secret": "your-random-secret" },
  "alerts": {
    "cpu": { "warning": 80, "critical": 90 },
    "memory": { "warning": 75, "critical": 90 }
  }
}
```

### Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` for production secrets.

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| **Backend** | Node.js + Express |
| **Frontend** | Vanilla JS + Tailwind CSS |
| **Database** | JSON file-based |
| **Charts** | Chart.js |
| **Icons** | Font Awesome |
| **Container** | dockerode |
| **Process** | PM2 API |
| **System** | systeminformation |
| **Alerts** | Telegram Bot API |

---

## 🔒 Security Best Practices

### For Production:

1. **HTTPS** - Use reverse proxy (Nginx/Caddy)
2. **Firewall** - Restrict to trusted IPs
3. **Passwords** - Change defaults immediately
4. **env** - Use `.env` for secrets
5. **Updates** - Keep dependencies current

**Example Nginx Config:**

```nginx
server {
    listen 443 ssl;
    server_name panel.yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
```

---

## 🐛 Troubleshooting

### Common Issues

**Q: Port 3000 already in use?**  
A: Change port in `config/config.json`

**Q: Terminal won't connect?**  
A: Check WebSocket isn't blocked, verify authentication

**Q: Permission denied on Linux?**  
A: Add user to docker group: `sudo usermod -aG docker $USER`

**Q: Upload fails?**  
A: Check disk space & file size (<10MB)

---

## 🤝 Contributing

We love contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Ways to contribute:**
- 🐛 Report bugs
- 💡 Suggest features
- 📝 Improve docs
- 🔧 Submit PRs

---

## 📊 Project Stats

- **Total Features:** 20+
- **Security Score:** 9/10
- **Cross-Platform:** Windows & Linux
- **Dependencies:** Minimal & secure
- **Bundle Size:** ~10MB (with deps)

---

## 📜 License

[MIT License](LICENSE) - Free & Open Source

---

## 🌟 Support

- **⭐ Star** this repo if you find it useful
- **🐛 Report** bugs via Issues
- **💬 Discuss** in GitHub Discussions
- **🔔 Watch** for updates

---

## 🙏 Acknowledgments

Built with ❤️ using:
- [Express.js](https://expressjs.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Chart.js](https://www.chartjs.org/)
- [systeminformation](https://github.com/sebhildebrandt/systeminformation)

---

<div align="center">

**Made for the Homelab Community** 🏠

[Report Bug](https://github.com/yourusername/home-panel/issues) • [Request Feature](https://github.com/yourusername/home-panel/issues) • [Documentation](docs/)

**⭐ Don't forget to star the repo!**

</div>
