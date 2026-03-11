const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

const projectsDir = path.join(__dirname, "../data/projects");

// 确保 projects 目录存在
if (!fs.existsSync(projectsDir)) {
  fs.mkdirSync(projectsDir, { recursive: true });
}

// 获取项目列表
router.get("/", (req, res) => {
  try {
    const folders = fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
    res.json({ success: true, projects: folders });
  } catch (error) {
    console.error("获取项目列表失败:", error);
    res.status(500).json({ error: "获取项目列表失败" });
  }
});

// 创建新项目
router.post("/", (req, res) => {
  try {
    const { projectName } = req.body;
    if (!projectName || typeof projectName !== "string" || projectName.trim() === "") {
      return res.status(400).json({ error: "项目名称无效" });
    }

    const safeName = projectName.trim().replace(/[\\/:*?"<>|]/g, ""); // 简单防注入
    const projectPath = path.join(projectsDir, safeName);

    if (fs.existsSync(projectPath)) {
      return res.status(400).json({ error: "项目已存在" });
    }

    fs.mkdirSync(projectPath, { recursive: true });

    // 可选：初始化空的 characters.json
    fs.writeFileSync(path.join(projectPath, "characters.json"), "{}", "utf8");

    res.json({ success: true, project: safeName, message: "项目创建成功" });
  } catch (error) {
    console.error("创建项目失败:", error);
    res.status(500).json({ error: "创建项目失败" });
  }
});

// 删除项目
router.delete("/:projectName", (req, res) => {
  try {
    const { projectName } = req.params;
    const projectPath = path.join(projectsDir, projectName);

    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: "项目不存在" });
    }

    fs.rmSync(projectPath, { recursive: true, force: true });
    res.json({ success: true, message: "项目删除成功" });
  } catch (error) {
    console.error("删除项目失败:", error);
    res.status(500).json({ error: "删除项目失败" });
  }
});

// 获取项目的角色配置
router.get("/:projectName/characters", (req, res) => {
  try {
    const { projectName } = req.params;
    const projectPath = path.join(projectsDir, projectName);

    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: "项目不存在" });
    }

    const charsPath = path.join(projectPath, "characters.json");
    if (fs.existsSync(charsPath)) {
      const data = fs.readFileSync(charsPath, "utf8");
      res.json({ success: true, characters: JSON.parse(data) });
    } else {
      res.json({ success: true, characters: {} });
    }
  } catch (error) {
    console.error("获取项目角色失败:", error);
    res.status(500).json({ error: "获取项目角色失败" });
  }
});

// 获取项目的草稿配置（原文文本以及解析出的卡片）
router.get("/:projectName/draft", (req, res) => {
  try {
    const { projectName } = req.params;
    const projectPath = path.join(projectsDir, projectName);

    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: "项目不存在" });
    }

    const draftPath = path.join(projectPath, "draft.json");
    if (fs.existsSync(draftPath)) {
      const data = fs.readFileSync(draftPath, "utf8");
      res.json({ success: true, draft: JSON.parse(data) });
    } else {
      res.json({ success: true, draft: { novelText: "", dialogueCards: [] } });
    }
  } catch (error) {
    console.error("获取项目草稿失败:", error);
    res.status(500).json({ error: "获取项目草稿失败" });
  }
});

// 保存项目的草稿配置
router.post("/:projectName/draft", (req, res) => {
  try {
    const { projectName } = req.params;
    const { novelText, dialogueCards } = req.body;

    const safeName = projectName.trim().replace(/[\\/:*?"<>|]/g, "");
    const projectPath = path.join(projectsDir, safeName);

    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: "项目不存在" });
    }

    const draftPath = path.join(projectPath, "draft.json");
    const draftData = {
      novelText: novelText || "",
      dialogueCards: dialogueCards || [],
    };

    fs.writeFileSync(draftPath, JSON.stringify(draftData, null, 2), "utf8");
    res.json({ success: true, message: "草稿保存成功" });
  } catch (error) {
    console.error("保存项目草稿失败:", error);
    res.status(500).json({ error: "保存项目草稿失败" });
  }
});

module.exports = router;
