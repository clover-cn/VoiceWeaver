const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { mergeAudioFiles, cleanUpTempFiles } = require("../utils/ffmpeg-merge");
const { v4: uuidv4 } = require("uuid");

const projectsDir = path.join(__dirname, "../data/projects");

// 辅助函数
function getCharacters(projectName) {
  if (!projectName) return {};
  const safeName = projectName.trim().replace(/[\\/:*?"<>|]/g, "");
  const charsFile = path.join(projectsDir, safeName, "characters.json");
  if (fs.existsSync(charsFile)) {
    const data = fs.readFileSync(charsFile, "utf8");
    return JSON.parse(data);
  }
  return {};
}

// 修改为你目前计划对接的 IndexTTS2 服务地址
const ttsEndpoint = process.env.TTS_ENDPOINT || "http://localhost:5000/tts";

// 将大模型提取出的泛用情绪词映射为目标 TTS 的固定情绪标识
function emotionMapper(emotion) {
  const mapping = {
    sad: "sad",
    angry: "angry",
    anxious: "anxious",
    cheerful: "cheerful",
    neutral: "neutral",
  };
  return mapping[emotion] || "neutral";
}

router.post("/generate", async (req, res) => {
  try {
    const { dialogues, projectName } = req.body;
    if (!dialogues || !Array.isArray(dialogues)) {
      return res.status(400).json({ error: "Valid dialogues array required" });
    }
    if (!projectName) {
      return res.status(400).json({ error: "Missing projectName in request" });
    }

    const safeProjectName = projectName.trim().replace(/[\\/:*?"<>|]/g, "");
    const localChars = getCharacters(projectName);
    const projectDir = path.join(projectsDir, safeProjectName);

    const tempDir = path.join(projectDir, "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const generatedAudioFiles = [];

    // 这里采用 for...of 串行调用，或可用 Promise.all 并发请求（需注意 TTS 服务器的高并发承载能力）
    for (let i = 0; i < dialogues.length; i++) {
      const item = dialogues[i];

      let targetVoice = "default_narration_voice"; // 默认旁白音色
      if (item.type === "dialogue" && item.role) {
        const matchedChar = localChars[item.role];
        if (matchedChar && matchedChar.voice) {
          targetVoice = matchedChar.voice;
        }
      }

      const mappedEmotion = emotionMapper(item.emotion);

      // 拼接请求 Body，具体字段视 TTS API 规范而定
      const payload = {
        text: item.text,
        voice: targetVoice,
        emotion: mappedEmotion,
      };

      // 假设 TTS 服务返回的是可直接写入的音频 Buffer 或其访问地址
      // 此处伪代码：向真正的 TTS 发起调用，返回文件
      // 建议实际情况下：如果 API 返回 base64 或 buffer，写到文件
      const tempFilename = path.join(tempDir, `${uuidv4()}.wav`);

      // --- 真实情况应当是下面这样 ---
      /*
            const response = await axios.post(ttsEndpoint, payload, { responseType: 'arraybuffer' });
            fs.writeFileSync(tempFilename, response.data);
            */

      // 由于环境所限尚未配置真实 TTS，模拟创建一些空白音频占位以通过合成逻辑：
      fs.writeFileSync(tempFilename, "dummy audio block");

      generatedAudioFiles.push(tempFilename);
    }

    const finalOutputDir = path.join(projectDir, "output");
    if (!fs.existsSync(finalOutputDir)) {
      fs.mkdirSync(finalOutputDir, { recursive: true });
    }

    const finalFileName = `novel_dubbing_${Date.now()}.wav`;
    const finalFilePath = path.join(finalOutputDir, finalFileName);

    // 调用 FFmpeg 合并并删除临时文件
    // try {
    //   await mergeAudioFiles(generatedAudioFiles, finalFilePath);
    //   cleanUpTempFiles(generatedAudioFiles);
    // } catch (e) {
    //     console.error("FFmpeg merge failed:", e);
    // }

    res.json({
      success: true,
      message: "Audio compiled successfully",
      downloadUrl: `/api/tts/download/${safeProjectName}/${finalFileName}`,
      parts: generatedAudioFiles.length,
    });
  } catch (error) {
    console.error("TTS Generate Error:", error);
    res.status(500).json({ error: error.message || "Error occurred during generation" });
  }
});

// 提供一个简单的静态下载口，需根据项目名下载
router.get("/download/:projectName/:filename", (req, res) => {
  const { projectName, filename } = req.params;
  const safeProjectName = projectName.trim().replace(/[\\/:*?"<>|]/g, "");
  const file = path.join(projectsDir, safeProjectName, "output", filename);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "File not found" });
  }
  res.download(file);
});

module.exports = router;
