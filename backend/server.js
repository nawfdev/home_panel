const express = require("express");
const session = require("express-session");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const config = require("../config/config.json");
const { initDatabase } = require("./services/database");

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

const app = express();

// Security: Helmet for HTTP headers
app.use(helmet({
  contentSecurityPolicy: false // Allow inline scripts for now
}));

// Security: Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later."
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // Only 5 login attempts per 15 minutes
  message: "Too many login attempts, please try again later.",
  skipSuccessfulRequests: true
});

app.use("/api/", limiter);
app.use("/api/auth/login", authLimiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: config.session.maxAge
  }
}));

app.use(express.static(path.join(__dirname, "../frontend")));

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

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

initDatabase();

// Initialize Telegram Bot
const { initBot } = require("./services/telegram");
initBot();

// Start Alert Monitoring
const { startAlertMonitoring } = require("./services/alerts");
startAlertMonitoring();

// Start Metrics Collection
const { startMetricsCollection } = require("./services/metrics");
startMetricsCollection();

const PORT = config.server.port || 3000;
const HOST = config.server.host || "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
  console.log(`Home Panel - Server Started`);
  console.log(`URL: http://${HOST}:${PORT}`);
  console.log(`Default Login: admin / SecurePass2026!`);
});

// Initialize Web Terminal with session authentication
const { initTerminalServer } = require("./services/terminal");
initTerminalServer(server, session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false
}));
