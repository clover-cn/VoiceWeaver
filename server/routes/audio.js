const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

// 确保目录存在
const uploadDir = path.join(__dirname, "../uploads/reference_audios");
const dataDir = path.join(__dirname, "../data");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 配置文件存储路径
const audioRecordsPath = path.join(dataDir, "audio_records.json");
const globalRolesPath = path.join(dataDir, "global_roles.json");

// 初始化数据据文件
if (!fs.existsSync(audioRecordsPath)) fs.writeFileSync(audioRecordsPath, "[]", "utf8");
if (!fs.existsSync(globalRolesPath)) fs.writeFileSync(globalRolesPath, "{}", "utf8");

// Multer 配置
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueName = uuidv4() + ext;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage: storage });

// 辅助函数：读取和写入记录
function getAudioRecords() {
  const data = fs.readFileSync(audioRecordsPath, "utf8");
  return JSON.parse(data);
}
function saveAudioRecords(records) {
  fs.writeFileSync(audioRecordsPath, JSON.stringify(records, null, 2), "utf8");
}
function getGlobalRoles() {
  const data = fs.readFileSync(globalRolesPath, "utf8");
  return JSON.parse(data);
}
function saveGlobalRoles(roles) {
  fs.writeFileSync(globalRolesPath, JSON.stringify(roles, null, 2), "utf8");
}

// --- 参考音频库管理 API ---

// 1. 上传音频
router.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "没有上传文件" });
    }

    // 自定义音频名称（默认为文件名）
    const customName = req.body.name || req.file.originalname.replace(path.extname(req.file.originalname), "");

    const newRecord = {
      id: uuidv4(),
      name: customName,
      fileName: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      createTime: new Date().toISOString(),
      url: `/uploads/reference_audios/${req.file.filename}`
    };

    const records = getAudioRecords();
    records.push(newRecord);
    saveAudioRecords(records);

    res.json({ success: true, message: "上传成功", data: newRecord });
  } catch (error) {
    console.error("音频上传错误:", error);
    res.status(500).json({ error: "上传失败" });
  }
});

// 2. 获取所有参考音频列表
router.get("/list", (req, res) => {
  try {
    const records = getAudioRecords();
    // 按时间倒序
    records.sort((a, b) => new Date(b.createTime) - new Date(a.createTime));
    res.json({ success: true, list: records });
  } catch (error) {
    console.error("获取音频列表错误:", error);
    res.status(500).json({ error: "获取音频列表失败" });
  }
});

// 3. 删除参考音频
router.delete("/:id", (req, res) => {
  try {
    const { id } = req.params;
    let records = getAudioRecords();
    const recordIndex = records.findIndex(r => r.id === id);

    if (recordIndex === -1) {
      return res.status(404).json({ error: "未找到该音频记录" });
    }

    const record = records[recordIndex];
    // 删除物理文件
    const filePath = path.join(uploadDir, record.fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // 从记录中移除
    records.splice(recordIndex, 1);
    saveAudioRecords(records);

    // 同步清理全局角色中绑定的该音频
    const globalRoles = getGlobalRoles();
    let rolesModified = false;
    for (const [roleName, audioId] of Object.entries(globalRoles)) {
      if (audioId === id) {
        delete globalRoles[roleName];
        rolesModified = true;
      }
    }
    if (rolesModified) {
      saveGlobalRoles(globalRoles);
    }

    res.json({ success: true, message: "删除成功" });
  } catch (error) {
    console.error("删除音频错误:", error);
    res.status(500).json({ error: "删除失败" });
  }
});

// --- 全局角色音频绑定 API ---

// 4. 获取所有全局角色的音频绑定
router.get("/global-roles", (req, res) => {
  try {
    const roles = getGlobalRoles();
    const records = getAudioRecords();

    // 组装格式，将对应的音频详情加上去，方便前端显示
    const result = {};
    for (const [roleName, audioId] of Object.entries(roles)) {
      const audio = records.find(r => r.id === audioId);
      if (audio) {
        result[roleName] = audio;
      } else {
        // 如果文件已经被意外删除但绑定还在，则清理
        delete roles[roleName];
      }
    }

    res.json({ success: true, roles: result });
  } catch (error) {
    console.error("获取全局角色绑定错误:", error);
    res.status(500).json({ error: "获取全局角色绑定失败" });
  }
});

// 5. 更新（完全覆盖）全局角色的音频绑定
router.post("/global-roles", (req, res) => {
  try {
    // 期望结构 { "角色A": "音频IDA", "角色B": "音频IDB" }
    const { bindings } = req.body;

    if (!bindings || typeof bindings !== 'object') {
      return res.status(400).json({ error: "参数格式不正确" });
    }

    const roles = getGlobalRoles();
    // 合并覆盖
    for (const [roleName, audioId] of Object.entries(bindings)) {
      // 如果前端发来空字符、null 或 undefined，表示要取消该角色的绑定
      if (!audioId) {
        delete roles[roleName];
      } else if (audioId) {
        roles[roleName] = audioId;
      }
    }

    saveGlobalRoles(roles);
    res.json({ success: true, message: "角色全局音频绑定更新成功" });
  } catch (error) {
    console.error("保存全局角色绑定错误:", error);
    res.status(500).json({ error: "保存失败" });
  }
});

module.exports = router;
