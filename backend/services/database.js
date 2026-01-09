const bcrypt = require('bcryptjs');

// In-memory storage
let users = [];
let settings = {};

// Initialize default admin
function initDefaultAdmin() {
  const config = require('../../config/config.json');

  // Check if password is already hashed
  const password = config.defaultAdmin.password.startsWith('$2b$')
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
        if (sql.includes('SELECT') && sql.includes('username')) {
          return users.find(u => u.username === param);
        }
        return null;
      },
      run: (...params) => {
        // Simple insert
        if (sql.includes('INSERT')) {
          const newUser = {
            id: users.length + 1,
            username: params[0],
            password: params[1],
            role: params[2] || 'user'
          };
          users.push(newUser);
          return { lastInsertRowid: newUser.id };
        }
      }
    })
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
