const express = require("express");
const router = express.Router();
const multer = require("multer");
const axios = require("axios");
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
  try {
    const raw = fs.readFileSync(globalRolesPath, "utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.warn("global_roles.json 读取或解析失败，已自动回退为空对象:", e.message);
    return {};
  }
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

    // 修复 multer 中文文件名乱码：Latin-1 → UTF-8
    const decodedOriginalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    // 自定义音频名称（默认为文件名去掉扩展名）
    const customName = req.body.name || decodedOriginalName.replace(path.extname(decodedOriginalName), "");

    const newRecord = {
      id: uuidv4(),
      name: customName,
      fileName: req.file.filename,
      originalName: decodedOriginalName,
      size: req.file.size,
      createTime: new Date().toISOString(),
      url: `/uploads/reference_audios/${req.file.filename}`,
      remark: "",
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
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    let records = getAudioRecords();
    const recordIndex = records.findIndex((r) => r.id === id);
    if (recordIndex === -1) {
      return res.status(404).json({ error: "未找到该音频记录" });
    }
    const record = records[recordIndex];
    console.log("准备删除：", record);
    console.log("delete id:", id);
    // 先删除 SiliconFlow 上的语音(若存在)，成功后再删本地
    if (record.siliconUri) {
      const apiKey = process.env.SILICONFLOW_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "缺少 SILICONFLOW_API_KEY，已中止本地删除" });
      }
      try {
        const delRes = await axios.post(
          "https://api.siliconflow.cn/v1/audio/voice/deletions",
          { uri: record.siliconUri },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
          },
        );
        console.log("删除结果：", delRes.data);

        if (delRes.status < 200 || delRes.status >= 300) {
          return res.status(502).json({ error: "线上语音删除失败，已中止本地删除" });
        }
      } catch (err) {
        console.error("删除 SiliconFlow 语音失败:", err.response ? JSON.stringify(err.response.data) : err.message);
        return res.status(502).json({ error: "线上语音删除失败，已中止本地删除" });
      }
    }
    // 删除物理文件
    const filePath = path.join(uploadDir, record.fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // 从记录中移除
    records.splice(recordIndex, 1);
    saveAudioRecords(records);

    // 同步清理全局角色中绑定的该音频（嵌套情感结构）
    const globalRoles = getGlobalRoles();
    let rolesModified = false;
    for (const roleName in globalRoles) {
      const emotionMap = globalRoles[roleName];
      if (typeof emotionMap === "object" && emotionMap !== null) {
        for (const emotion in emotionMap) {
          const config = emotionMap[emotion];
          if (config === id || (config && typeof config === "object" && config.id === id)) {
            delete emotionMap[emotion];
            rolesModified = true;
          }
        }
        // 如果该角色的所有情感维度绑定均已清空，就删除整个角色条目
        if (Object.keys(emotionMap).length === 0) {
          delete globalRoles[roleName];
        }
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

    // 组装格式，支持新版带模式和权重的对象结构
    const result = {};
    for (const roleName in roles) {
      const emotionMap = roles[roleName];
      if (typeof emotionMap !== "object" || emotionMap === null) continue;
      result[roleName] = {};
      for (const emotion in emotionMap) {
        const config = emotionMap[emotion];
        const audioInfo = typeof config === "string" ? { id: config } : { ...config };

        const audio = records.find((r) => r.id === audioInfo.id);
        if (audio || audioInfo.mode === 3) {
          result[roleName][emotion] = { ...audioInfo, ...audio };
        }
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
    const { bindings } = req.body;

    if (!bindings || typeof bindings !== "object") {
      return res.status(400).json({ error: "参数格式不正确" });
    }

    const roles = getGlobalRoles();

    for (const roleName in bindings) {
      const emotionMap = bindings[roleName];
      if (!emotionMap || typeof emotionMap !== "object") {
        delete roles[roleName];
        continue;
      }

      if (!roles[roleName] || typeof roles[roleName] !== "object") {
        roles[roleName] = {};
      }

      for (const emotion in emotionMap) {
        const config = emotionMap[emotion];
        // 如果传入 null 或者无有效配置，则删除对应情感
        if (!config || (typeof config === "object" && !config.id && config.mode !== 3)) {
          delete roles[roleName][emotion];
        } else {
          roles[roleName][emotion] = config;
        }
      }

      // 如果该角色的情感维度均已清空，就删除该角色
      if (Object.keys(roles[roleName]).length === 0) {
        delete roles[roleName];
      }
    }

    saveGlobalRoles(roles);
    res.json({ success: true, message: "角色全局音频绑定更新成功" });
  } catch (error) {
    console.error("保存全局角色绑定错误:", error);
    res.status(500).json({ error: "保存失败" });
  }
});

// 6. 更新参考音频的备注
router.patch("/:id/remark", (req, res) => {
  try {
    const { id } = req.params;
    const { remark } = req.body;

    if (typeof remark !== "string") {
      return res.status(400).json({ error: "remark 必须为字符串" });
    }

    const records = getAudioRecords();
    const record = records.find((r) => r.id === id);

    if (!record) {
      return res.status(404).json({ error: "未找到该音频记录" });
    }

    record.remark = remark;
    saveAudioRecords(records);
    res.json({ success: true, message: "备注更新成功" });
  } catch (error) {
    console.error("更新备注错误:", error);
    res.status(500).json({ error: "更新备注失败" });
  }
});

// 7. 更新参考音频的参考文本（siliconflow 模式专用）
router.patch("/:id/sample-text", (req, res) => {
  try {
    const { id } = req.params;
    const { sampleText } = req.body;

    if (typeof sampleText !== "string") {
      return res.status(400).json({ error: "sampleText 必须为字符串" });
    }

    const records = getAudioRecords();
    const record = records.find((r) => r.id === id);

    if (!record) {
      return res.status(404).json({ error: "未找到该音频记录" });
    }

    record.sampleText = sampleText;

    // 保留 siliconUri，避免参考文本编辑后丢失线上克隆语音

    saveAudioRecords(records);
    res.json({ success: true, message: "参考文本更新成功" });
  } catch (error) {
    console.error("更新参考文本错误:", error);
    res.status(500).json({ error: "更新参考文本失败" });
  }
});

module.exports = router;
