const express = require("express");
const { isAuthenticated } = require("./auth");
const projects = require("../services/projects");

const router = express.Router();

router.get("/", isAuthenticated, (req, res) => {
  try {
    const allProjects = projects.getAllProjects();
    res.json(allProjects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id", isAuthenticated, (req, res) => {
  try {
    const project = projects.getProject(parseInt(req.params.id));
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/", isAuthenticated, (req, res) => {
  try {
    const { name, path, port, domain } = req.body;
    if (!name || !path || !port) {
      return res.status(400).json({ error: "name, path, and port required" });
    }
    const project = projects.addProject(name, path, port, domain);
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/:id", isAuthenticated, (req, res) => {
  try {
    const project = projects.updateProject(parseInt(req.params.id), req.body);
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", isAuthenticated, (req, res) => {
  try {
    const result = projects.deleteProject(parseInt(req.params.id));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/:id/start", isAuthenticated, async (req, res) => {
  try {
    const result = await projects.startProject(parseInt(req.params.id));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/:id/stop", isAuthenticated, (req, res) => {
  try {
    const result = projects.stopProject(parseInt(req.params.id));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/:id/restart", isAuthenticated, async (req, res) => {
  try {
    const result = await projects.restartProject(parseInt(req.params.id));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id/logs", isAuthenticated, (req, res) => {
  try {
    const logs = projects.getProjectLogs(parseInt(req.params.id));
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
