const express = require("express");
const bcrypt = require("bcryptjs");
const { getDb } = require("../services/database");

const router = express.Router();

function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
}

router.post("/login", (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role
  };

  res.json({ success: true, user: req.session.user });
});

router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }
    res.json({ success: true });
  });
});

router.get("/me", isAuthenticated, (req, res) => {
  res.json({ user: req.session.user });
});

router.post("/change-password", isAuthenticated, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new password required" });
  }

  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.user.id);

  if (!bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }

  const hashedPassword = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashedPassword, user.id);

  res.json({ success: true, message: "Password changed successfully" });
});

module.exports = router;
module.exports.isAuthenticated = isAuthenticated;
