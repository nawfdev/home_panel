const express = require("express");
const session = require("express-session");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const config = require("../config/config.json");
const { initDefaultAdmin } = require("./services/database");

const authRoutes = require("./routes/auth");
const dashboardRoutes = require("./routes/dashboard");
const tunnelRoutes = require("./routes/tunnel");
const projectsRoutes = require("./routes/projects");
const systemRoutes = require("./routes/system");
const telegramRoutes = require("./routes/telegram");
const networkRoutes = require("./routes/network");
const dockerRoutes = require("./routes/docker-routes");
const pm2Routes = require("./routes/pm2-routes");
const logsRoutes = require("./routes/logs");
const servicesRoutes = require("./routes/services");
const metricsRoutes = require("./routes/metrics");
const filesRoutes = require("./routes/files");
const settingsRoutes = require("./routes/settings");
const cloudflareRoutes = require("./routes/cloudflare");

const app = express();

// Security: Helmet for HTTP headers
app.use(helmet({
  contentSecurityPolicy: false // Allow inline scripts for now
}));

// Security: Rate limiting (higher for homelab single-user)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 requests per 15 minutes (homelab friendly)
  message: { error: "Too many requests from this IP, please try again later." }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 login attempts per 15 minutes (increased from 5)
  message: { error: "Too many login attempts, please try again later." },
  skipSuccessfulRequests: true
});

app.use("/api/", limiter);
app.use("/api/auth/login", authLimiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SHARED session parser for Express and WebSocket
const sessionParser = session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: config.session.maxAge
  }
});

app.use(sessionParser);

app.use(express.static(path.join(__dirname, "../frontend")));

// Register Routes
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/tunnel", tunnelRoutes);
app.use("/api/projects", projectsRoutes);
app.use("/api/system", systemRoutes);
app.use("/api/telegram", telegramRoutes);
app.use("/api/network", networkRoutes);
app.use("/api/docker", dockerRoutes);
app.use("/api/pm2", pm2Routes);
app.use("/api/logs", logsRoutes);
app.use("/api/services", servicesRoutes);
app.use("/api/metrics", metricsRoutes);
app.use("/api/files", filesRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/cloudflare", cloudflareRoutes);

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

initDefaultAdmin();

// Initialize Telegram Bot
const { initBot } = require("./services/telegram");
initBot();

// Start Alert Monitoring
const { startAlertMonitoring } = require("./services/alerts");
startAlertMonitoring();

// Start Metrics Collection
const { startMetricsCollection } = require("./services/metrics");
startMetricsCollection();

const PORT = config.server.port || 9689;
const HOST = config.server.host || "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
  console.log(`Home Panel - Server Started`);
  console.log(`URL: http://${HOST}:${PORT}`);
  console.log(`Default Login: admin / admin123`);
});

// Initialize Web Terminal with SHARED session parser
const { initTerminalServer } = require("./services/terminal");
initTerminalServer(server, sessionParser);
