const express = require("express");
const fs = require("fs");
const path = require("path");
const { loadProjectCasting, saveProjectCasting, parseAudioRecordName, loadProjectReaderSettings, saveProjectReaderSettings } = require("../services/autoCastingService");
const { clearProjectListenCache } = require("../services/listenBookCacheService");

const router = express.Router();

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
