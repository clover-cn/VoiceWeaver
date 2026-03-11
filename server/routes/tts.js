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

const ttsEndpoint = process.env.TTS_ENDPOINT || "http://localhost:5000/tts";

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

// 1. 生成单条音频
router.post("/generate-single", async (req, res) => {
  try {
    const { dialogue, projectName } = req.body;
    if (!dialogue || !projectName) {
      return res.status(400).json({ error: "Missing dialogue or projectName in request" });
    }

    const safeProjectName = projectName.trim().replace(/[\\/:*?"<>|]/g, "");
    const localChars = getCharacters(projectName);
    const projectDir = path.join(projectsDir, safeProjectName);

    const tempDir = path.join(projectDir, "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    let targetVoice = "default_narration_voice";
    if (dialogue.type === "dialogue" && dialogue.role) {
      const matchedChar = localChars[dialogue.role];
      if (matchedChar && matchedChar.voice) {
        targetVoice = matchedChar.voice;
      }
    }

    const mappedEmotion = emotionMapper(dialogue.emotion);

    const payload = {
      text: dialogue.text,
      voice: targetVoice,
      emotion: mappedEmotion,
    };

    const fileName = `${uuidv4()}.wav`;
    const tempFilename = path.join(tempDir, fileName);

    // --- 真实情况应当是向真正的 TTS 发起调用 ---
    // const response = await axios.post(ttsEndpoint, payload, { responseType: 'arraybuffer' });
    // fs.writeFileSync(tempFilename, response.data);
    fs.writeFileSync(tempFilename, "dummy audio block");

    res.json({
      success: true,
      message: "Audio generated successfully",
      fileName: fileName,
      audioUrl: `/api/tts/preview/${safeProjectName}/${fileName}`,
    });
  } catch (error) {
    console.error("TTS Generate Single Error:", error);
    res.status(500).json({ error: error.message || "Error occurred during generation" });
  }
});

// 2. 合并多段音频
router.post("/merge", async (req, res) => {
  try {
    const { fileNames, projectName } = req.body;
    if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
      return res.status(400).json({ error: "Valid fileNames array required" });
    }
    if (!projectName) {
      return res.status(400).json({ error: "Missing projectName in request" });
    }

    const safeProjectName = projectName.trim().replace(/[\\/:*?"<>|]/g, "");
    const projectDir = path.join(projectsDir, safeProjectName);
    const tempDir = path.join(projectDir, "temp");
    const finalOutputDir = path.join(projectDir, "output");

    if (!fs.existsSync(finalOutputDir)) {
      fs.mkdirSync(finalOutputDir, { recursive: true });
    }

    // 映射出真实的绝对路径
    const inputFiles = fileNames.map(name => path.join(tempDir, name));

    // 检查文件是否存在
    for (const file of inputFiles) {
      if (!fs.existsSync(file)) {
        return res.status(404).json({ error: `File not found: ${path.basename(file)}` });
      }
    }

    const finalFileName = `novel_dubbing_${Date.now()}.wav`;
    const finalFilePath = path.join(finalOutputDir, finalFileName);

    // try {
    //   await mergeAudioFiles(inputFiles, finalFilePath);
    //   cleanUpTempFiles(inputFiles);
    // } catch (e) {
    //   console.error("FFmpeg merge failed:", e);
    // }
    
    // 模拟成功合并：
    fs.writeFileSync(finalFilePath, "dummy merged audio");

    res.json({
      success: true,
      message: "Audio compiled successfully",
      downloadUrl: `/api/tts/download/${safeProjectName}/${finalFileName}`,
    });
  } catch (error) {
    console.error("TTS Merge Error:", error);
    res.status(500).json({ error: error.message || "Error occurred during merge" });
  }
});

// 提供一个简单的静态下载口，成品音频
router.get("/download/:projectName/:filename", (req, res) => {
  const { projectName, filename } = req.params;
  const safeProjectName = projectName.trim().replace(/[\\/:*?"<>|]/g, "");
  const file = path.join(projectsDir, safeProjectName, "output", filename);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "Final audio file not found" });
  }
  res.download(file);
});

// 提供分段试听静态访问口，临时音频
router.get("/preview/:projectName/:filename", (req, res) => {
  const { projectName, filename } = req.params;
  const safeProjectName = projectName.trim().replace(/[\\/:*?"<>|]/g, "");
  const file = path.join(projectsDir, safeProjectName, "temp", filename);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "Preview audio file not found" });
  }
  // 使用 res.sendFile 以便于 H5 标签直接播放
  res.sendFile(file);
});

module.exports = router;
