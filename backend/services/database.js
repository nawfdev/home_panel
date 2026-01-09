const bcrypt = require('bcryptjs');

// In-memory storage
let users = [];
let projects = []; // Add projects storage
let settings = {};

// Initialize default admin
function initDefaultAdmin() {
  const config = require('../../config/config.json');

  // Check if password is already hashed (bcrypt prefixes: $2a$ or $2b$)
  const isHashed = config.defaultAdmin.password.startsWith('$2a$') || config.defaultAdmin.password.startsWith('$2b$');
  const password = isHashed
    ? config.defaultAdmin.password
    : bcrypt.hashSync(config.defaultAdmin.password, 10);

  users = [{
    id: 1,
    username: 'admin',
    password: password,
    role: 'admin'
  }];
}

function getDb() {
  if (users.length === 0) {
    initDefaultAdmin();
  }

  return {
    prepare: (sql) => ({
      get: (param) => {
        // Users by username
        if (sql.includes('SELECT') && sql.includes('username')) {
          return users.find(u => u.username === param);
        }
        // Users by id
        if (sql.includes('SELECT') && sql.includes('users') && sql.includes('id')) {
          return users.find(u => u.id === param);
        }
        // Tunnels - return null
        if (sql.includes('SELECT') && sql.includes('tunnels')) {
          return null;
        }
        // Projects by id
        if (sql.includes('SELECT') && sql.includes('projects') && sql.includes('id')) {
          return projects.find(p => p.id === param);
        }
        return null;
      },
      all: () => {
        // Return all projects (for getAllProjects)
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
          return { lastInsertRowid: newUser.id };
        }
        // UPDATE password
        if (sql.includes('UPDATE') && sql.includes('password')) {
          const user = users.find(u => u.id === params[1]);
          if (user) {
            user.password = params[0];
            return { changes: 1 };
          }
        }
        // DELETE project
        if (sql.includes('DELETE') && sql.includes('projects')) {
          const index = projects.findIndex(p => p.id === params[0]);
          if (index > -1) {
            projects.splice(index, 1);
            return { changes: 1 };
          }
        }
      }
    }),
    // Helper for updateProject
    updateProject: (id, data) => {
      const project = projects.find(p => p.id === id);
      if (project) {
        Object.assign(project, data);
      }
    }
  };
}

// Simple settings store functions
function getSetting(key) {
  return settings[key];
}

function setSetting(key, value) {
  settings[key] = value;
  return value;
}

module.exports = { getDb, initDefaultAdmin, getSetting, setSetting };
