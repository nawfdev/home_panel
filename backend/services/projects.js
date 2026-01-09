const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { getDb } = require("./database");

const runningProjects = new Map();

function getAllProjects() {
  const db = getDb();
  return db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
}

function getProject(id) {
  const db = getDb();
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
}

function addProject(name, projectPath, port, domain = null) {
  const db = getDb();
  const result = db.prepare(
    "INSERT INTO projects (name, path, port, domain, status) VALUES (?, ?, ?, ?, ?)"
  ).run(name, projectPath, port, domain, "stopped");
  return { id: result.lastInsertRowid, name, path: projectPath, port, domain, status: "stopped" };
}

function updateProject(id, data) {
  const db = getDb();
  db.updateProject(id, data);
  return getProject(id);
}

function deleteProject(id) {
  const project = getProject(id);
  if (project && project.status === "running") {
    stopProject(id);
  }
  const db = getDb();
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return { success: true };
}

async function startProject(id) {
  const project = getProject(id);
  if (!project) {
    return { success: false, message: "Project not found" };
  }

  if (!fs.existsSync(project.path)) {
    return { success: false, message: "Project path does not exist" };
  }

  const packageJson = path.join(project.path, "package.json");
  let startCommand = "npm start";
  
  if (fs.existsSync(packageJson)) {
    const pkg = JSON.parse(fs.readFileSync(packageJson, "utf-8"));
    if (pkg.scripts && pkg.scripts.start) {
      startCommand = "npm start";
    } else if (pkg.scripts && pkg.scripts.dev) {
      startCommand = "npm run dev";
    }
  }

  const [cmd, ...args] = startCommand.split(" ");
  const proc = spawn(cmd, args, {
    cwd: project.path,
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: project.port }
  });

  let logs = [];
  proc.stdout.on("data", (data) => {
    logs.push({ type: "stdout", data: data.toString(), time: new Date() });
    if (logs.length > 500) logs.shift();
  });
  proc.stderr.on("data", (data) => {
    logs.push({ type: "stderr", data: data.toString(), time: new Date() });
    if (logs.length > 500) logs.shift();
  });

  proc.on("close", (code) => {
    console.log(`Project ${project.name} exited with code ${code}`);
    runningProjects.delete(id);
    updateProject(id, { status: "stopped", pid: null });
  });

  runningProjects.set(id, { process: proc, logs });
  updateProject(id, { status: "running", pid: proc.pid });

  return { success: true, pid: proc.pid, message: `Project ${project.name} started on port ${project.port}` };
}

function stopProject(id) {
  const running = runningProjects.get(id);
  if (!running) {
    return { success: false, message: "Project is not running" };
  }

  try {
    if (process.platform === "win32") {
      exec(`taskkill /pid ${running.process.pid} /T /F`);
    } else {
      process.kill(-running.process.pid, "SIGTERM");
    }
  } catch (e) {
    running.process.kill("SIGTERM");
  }

  runningProjects.delete(id);
  updateProject(id, { status: "stopped", pid: null });

  return { success: true, message: "Project stopped" };
}

function restartProject(id) {
  stopProject(id);
  return startProject(id);
}

function getProjectLogs(id) {
  const running = runningProjects.get(id);
  if (!running) {
    return [];
  }
  return running.logs;
}

module.exports = {
  getAllProjects,
  getProject,
  addProject,
  updateProject,
  deleteProject,
  startProject,
  stopProject,
  restartProject,
  getProjectLogs
};
