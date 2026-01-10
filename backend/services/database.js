const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// Persistence paths
const DB_DIR = path.join(__dirname, '../../data');
const DB_FILE = path.join(DB_DIR, 'db.json');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  try { fs.mkdirSync(DB_DIR, { recursive: true }); } catch (e) { }
}

// In-memory storage (synced to file)
let users = [];
let projects = [];
let settings = {};

// Load Database from file
function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      users = data.users || [];
      projects = data.projects || [];
      settings = data.settings || {};
      console.log(`📦 Database loaded: ${users.length} users, ${projects.length} projects`);
    } catch (e) {
      console.error("❌ Failed to load database:", e.message);
    }
  }
}

// Save Database to file
function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users, projects, settings }, null, 2));
  } catch (e) {
    console.error("❌ Failed to save database:", e.message);
  }
}

// Initialize default admin
function initDefaultAdmin() {
  if (users.length > 0) return; // Already have users

  const config = require('../../config/config.json');
  const isHashed = config.defaultAdmin.password.startsWith('$2a$') || config.defaultAdmin.password.startsWith('$2b$');
  const password = isHashed ? config.defaultAdmin.password : bcrypt.hashSync(config.defaultAdmin.password, 10);

  users = [{ id: 1, username: 'admin', password, role: 'admin' }];
  saveDb();
  console.log("👤 Default admin initialized");
}

// Load on startup
loadDb();
initDefaultAdmin();

function getDb() {
  return {
    prepare: (sql) => ({
      get: (param) => {
        if (sql.includes('SELECT') && sql.includes('username')) {
          return users.find(u => u.username === param);
        }
        if (sql.includes('SELECT') && sql.includes('users') && sql.includes('id')) {
          return users.find(u => u.id === param);
        }
        if (sql.includes('SELECT') && sql.includes('tunnels')) {
          return null;
        }
        if (sql.includes('SELECT') && sql.includes('projects') && sql.includes('id')) {
          return projects.find(p => p.id === param);
        }
        return null;
      },
      all: () => {
        if (sql.includes('SELECT') && sql.includes('projects')) {
          return projects;
        }
        return [];
      },
      run: (...params) => {
        // INSERT into projects
        if (sql.includes('INSERT') && sql.includes('projects')) {
          const newProject = {
            id: projects.length + 1,
            name: params[0],
            path: params[1],
            port: params[2],
            domain: params[3],
            status: params[4] || 'stopped',
            created_at: new Date().toISOString()
          };
          projects.push(newProject);
          saveDb();
          return { lastInsertRowid: newProject.id };
        }
        // INSERT into users
        if (sql.includes('INSERT') && sql.includes('users')) {
          const newUser = {
            id: users.length + 1,
            username: params[0],
            password: params[1],
            role: params[2] || 'user'
          };
          users.push(newUser);
          saveDb();
          return { lastInsertRowid: newUser.id };
        }
        // UPDATE password
        if (sql.includes('UPDATE') && sql.includes('password')) {
          const user = users.find(u => u.id === params[1]);
          if (user) {
            user.password = params[0];
            saveDb();
            return { changes: 1 };
          }
        }
        // DELETE project
        if (sql.includes('DELETE') && sql.includes('projects')) {
          const index = projects.findIndex(p => p.id === params[0]);
          if (index > -1) {
            projects.splice(index, 1);
            saveDb();
            return { changes: 1 };
          }
        }
      }
    }),
    updateProject: (id, data) => {
      const project = projects.find(p => p.id === id);
      if (project) {
        Object.assign(project, data);
        saveDb();
      }
    }
  };
}

function getSetting(key) {
  return settings[key];
}

function setSetting(key, value) {
  settings[key] = value;
  saveDb();
  return value;
}

module.exports = { getDb, initDefaultAdmin, getSetting, setSetting };
