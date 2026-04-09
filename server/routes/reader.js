const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { loadProjectCasting, saveProjectCasting, parseAudioRecordName, loadProjectReaderSettings, saveProjectReaderSettings } = require("../services/autoCastingService");
const { clearProjectListenCache } = require("../services/listenBookCacheService");

const router = express.Router();

// 目标基础 URL
const TARGET_BASE_URL = "http://154.58.233.231:9080/reader3";
const dataDir = path.join(__dirname, "../data");
const audioRecordsPath = path.join(dataDir, "audio_records.json");

function getAudioRecords() {
  try {
    if (!fs.existsSync(audioRecordsPath)) return [];
    const raw = fs.readFileSync(audioRecordsPath, "utf8").trim();
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function clearListenBookCache(projectName, fromChapterIndex = 0) {
  try {
    clearProjectListenCache(projectName, fromChapterIndex);
  } catch (error) {
    console.warn("清理听书缓存失败:", error.message);
  }
}

/**
 * 搜索小说接口
 * 参数: key, concurrentCount (默认4), lastIndex (默认-1)
 */
router.get("/searchBookMultiSSE", async (req, res) => {
  try {
    const { key, concurrentCount = 4, lastIndex = -1 } = req.query;

    if (!key) {
      return res.status(400).json({ error: "缺少必需的查询参数: key" });
    }

    const response = await axios.get(`${TARGET_BASE_URL}/searchBookMultiSSE`, {
      params: {
        key,
        concurrentCount,
        lastIndex,
      },
    });

    // 第三方接口返回的是 SSE 流格式（以 `data: {...}` 开头的文本）
    // 我们在这里将它解析成普通的 JSON 对象返回给前端
    const rawText = response.data;
    const lines = rawText.split(/\r?\n/);

    let resultList = [];
    let finalLastIndex = -1;
    console.log("====", rawText);
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const jsonStr = line.replace("data: ", "").trim();
        if (jsonStr) {
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.data && Array.isArray(parsed.data)) {
              resultList.push(...parsed.data);
            }
            if (parsed.lastIndex !== undefined) {
              finalLastIndex = parsed.lastIndex;
            }
          } catch (e) {
            // 解析失败的数据块忽略不计
          }
        }
      }
    }

    // 将整个数据作为聚合的 JSON 返回给前端
    res.json({
      lastIndex: finalLastIndex,
      data: resultList,
    });
  } catch (error) {
    console.error("/searchBookMultiSSE 代理出错：", error.message);
    res.status(500).json({
      error: "代理错误",
      details: error.response?.data || error.message,
    });
  }
});

/**
 * 获取章节列表接口
 * 参数: url, bookSourceUrl
 */
router.get("/getChapterList", async (req, res) => {
  try {
    const { url, bookSourceUrl } = req.query;

    if (!url || !bookSourceUrl) {
      return res.status(400).json({ error: "缺少必需的查询参数：url、bookSourceUrl" });
    }

    const response = await axios.get(`${TARGET_BASE_URL}/getChapterList`, {
      params: {
        url,
        bookSourceUrl,
      },
    });

    res.json(response.data);
  } catch (error) {
    console.error("/getChapterList 代理出错：", error.message);
    res.status(500).json({
      error: "代理错误",
      details: error.response?.data || error.message,
    });
  }
});

/**
 * 获取小说正文接口
 * 参数: url, index
 */
router.get("/getBookContent", async (req, res) => {
  try {
    const { url, index = 0 } = req.query;

    if (!url) {
      return res.status(400).json({ error: "缺少必需的查询参数: url" });
    }

    const response = await axios.get(`${TARGET_BASE_URL}/getBookContent`, {
      params: {
        url,
        index,
      },
    });

    res.json(response.data);
  } catch (error) {
    console.error("/getBookContent 代理出错：", error.message);
    res.status(500).json({
      error: "代理错误",
      details: error.response?.data || error.message,
    });
  }
});

router.get("/role-audio-override", (req, res) => {
  try {
    const { projectName, role } = req.query;

    if (!projectName || !role) {
      return res.status(400).json({ error: "缺少 projectName 或 role" });
    }

    const casting = loadProjectCasting(projectName);
    const assignment = casting.roleAssignments?.[role] || null;
    const records = getAudioRecords();
    let audio = null;
    if (assignment?.voiceActor) {
      audio =
        records.find((item) => {
          const parsed = parseAudioRecordName(item.name);
          return parsed && parsed.voiceActor === assignment.voiceActor && parsed.emotion === "neutral";
        }) ||
        records.find((item) => {
          const parsed = parseAudioRecordName(item.name);
          return parsed && parsed.voiceActor === assignment.voiceActor;
        }) ||
        null;
    }

    res.json({
      success: true,
      role,
      projectName,
      assignment: assignment || null,
      voiceActor: assignment?.voiceActor || null,
      audio: audio
        ? {
            id: audio.id,
            name: audio.name,
            url: audio.url,
          }
        : null,
    });
  } catch (error) {
    console.error("获取角色手动参考音频失败:", error);
    res.status(500).json({ error: "获取角色手动参考音频失败" });
  }
});

router.post("/role-audio-override", (req, res) => {
  try {
    const { projectName, role, audioId, chapterIndex = 0, skipCacheInvalidation = false } = req.body || {};

    if (!projectName || !role) {
      return res.status(400).json({ error: "缺少 projectName 或 role" });
    }

    const casting = loadProjectCasting(projectName);
    const currentAssignment = casting.roleAssignments?.[role] || {};
    const records = getAudioRecords();

    if (!audioId) {
      if (casting.roleAssignments && casting.roleAssignments[role]) {
        delete casting.roleAssignments[role];
      }
      saveProjectCasting(projectName, casting);
      if (!skipCacheInvalidation) {
        clearListenBookCache(projectName, Number(chapterIndex) || 0);
      }
      return res.json({
        success: true,
        role,
        projectName,
        assignment: casting.roleAssignments?.[role] || null,
        clearedManualOverride: true,
      });
    }

    const targetAudio = records.find((item) => item.id === audioId);
    if (!targetAudio) {
      return res.status(404).json({ error: "目标参考音频不存在" });
    }

    const parsedAudio = parseAudioRecordName(targetAudio.name);
    if (!parsedAudio || !parsedAudio.voiceActor || parsedAudio.emotion === "narration") {
      return res.status(400).json({ error: "所选参考音频无法识别所属角色声线，请选择标准命名的角色音频" });
    }

    casting.roleAssignments[role] = {
      ...currentAssignment,
      voiceActor: parsedAudio.voiceActor,
      gender: parsedAudio.gender,
      manualOverride: true,
    };

    saveProjectCasting(projectName, casting);
    if (!skipCacheInvalidation) {
      clearListenBookCache(projectName, Number(chapterIndex) || 0);
    }

    res.json({
      success: true,
      role,
      projectName,
      assignment: casting.roleAssignments[role],
      voiceActor: parsedAudio.voiceActor,
      audio: {
        id: targetAudio.id,
        name: targetAudio.name,
        url: targetAudio.url,
      },
    });
  } catch (error) {
    console.error("保存角色手动参考音频失败:", error);
    res.status(500).json({ error: "保存角色手动参考音频失败" });
  }
});

router.get("/generation-settings", (req, res) => {
  try {
    const { projectName } = req.query || {};
    if (!projectName) {
      return res.status(400).json({ error: "缺少 projectName" });
    }

    const settings = loadProjectReaderSettings(projectName);
    res.json({
      success: true,
      projectName,
      settings,
    });
  } catch (error) {
    console.error("获取阅读生成配置失败:", error);
    res.status(500).json({ error: "获取阅读生成配置失败" });
  }
});

router.post("/generation-settings", (req, res) => {
  try {
    const { projectName, missingEmotionPolicy } = req.body || {};
    if (!projectName) {
      return res.status(400).json({ error: "缺少 projectName" });
    }
    if (!["strict", "fallback_neutral"].includes(missingEmotionPolicy)) {
      return res.status(400).json({ error: "missingEmotionPolicy 非法" });
    }

    const current = loadProjectReaderSettings(projectName);
    const nextSettings = {
      ...current,
      missingEmotionPolicy,
    };
    saveProjectReaderSettings(projectName, nextSettings);

    res.json({
      success: true,
      projectName,
      settings: nextSettings,
    });
  } catch (error) {
    console.error("保存阅读生成配置失败:", error);
    res.status(500).json({ error: "保存阅读生成配置失败" });
  }
});

module.exports = router;
