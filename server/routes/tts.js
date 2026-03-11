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



// 1. 生成单条音频
router.post("/generate-single", async (req, res) => {
  try {
    const { dialogue, projectName } = req.body;
    if (!dialogue || !projectName) {
      return res.status(400).json({ error: "请求中缺少对话内容或项目名称。" });
    }

    const safeProjectName = projectName.trim().replace(/[\\/:*?"<>|]/g, "");
    const localChars = getCharacters(projectName);
    const projectDir = path.join(projectsDir, safeProjectName);

    const tempDir = path.join(projectDir, "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    let targetVoice = "fnlp/MOSS-TTSD-v0.5:alex";
    if (dialogue.type === "dialogue" && dialogue.role) {
      const matchedChar = localChars[dialogue.role];
      // 请求角色的配置音色是 "default_voice" 或为空时，降级强制为它使用默认的有效发声模型 "fnlp/MOSS-TTSD-v0.5:alex"
      if (matchedChar && matchedChar.voice && matchedChar.voice !== "default_voice") {
        targetVoice = matchedChar.voice;
      }
    }
    console.log('当前使用的音频模型为：', targetVoice);
    const fileName = `${uuidv4()}.mp3`;
    const tempFilename = path.join(tempDir, fileName);

    // 调用 SiliconFlow API
    const API_KEY = process.env.SILICONFLOW_API_KEY;
    const TTS_URL = process.env.TTS_ENDPOINT || "https://api.siliconflow.cn/v1/audio/speech";

    try {
      const response = await axios({
        method: "POST",
        url: TTS_URL,
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        data: {
          model: "IndexTeam/IndexTTS-2",
          input: dialogue.text,
          voice: targetVoice,
          response_format: "mp3",
          stream: true
        },
        responseType: "stream"
      });

      const writer = fs.createWriteStream(tempFilename);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
    } catch (apiError) {
      console.error("API Error:", apiError.message);
      return res.status(500).json({ error: "API 请求失败" });
    }

    res.json({
      success: true,
      message: "Audio generated successfully",
      fileName: fileName,
      audioUrl: `/api/tts/preview/${safeProjectName}/${fileName}`,
    });
  } catch (error) {
    console.error("TTS 生成单个错误:", error);
    res.status(500).json({ error: error.message || "生成过程中出现错误" });
  }
});

// 2. 合并多段音频
router.post("/merge", async (req, res) => {
  try {
    const { fileNames, projectName } = req.body;
    if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
      return res.status(400).json({ error: "需要有效的文件名数组" });
    }
    if (!projectName) {
      return res.status(400).json({ error: "请求中缺少项目名称" });
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
        return res.status(404).json({ error: `文件未找到: ${path.basename(file)}` });
      }
    }

    const finalFileName = `novel_dubbing_${Date.now()}.mp3`;
    const finalFilePath = path.join(finalOutputDir, finalFileName);

    try {
      await mergeAudioFiles(inputFiles, finalFilePath);
      // cleanUpTempFiles(inputFiles);
    } catch (e) {
      console.error("FFmpeg 合并失败:", e);
      return res.status(500).json({ error: "FFmpeg 合并失败，请确保已安装 ffmpeg" });
    }

    res.json({
      success: true,
      message: "音频编译成功",
      downloadUrl: `/api/tts/download/${safeProjectName}/${finalFileName}`,
    });
  } catch (error) {
    console.error("TTS 合并错误:", error);
    res.status(500).json({ error: error.message || "合并过程中出现错误" });
  }
});

// 提供一个简单的静态下载口，成品音频
router.get("/download/:projectName/:filename", (req, res) => {
  const { projectName, filename } = req.params;
  const safeProjectName = projectName.trim().replace(/[\\/:*?"<>|]/g, "");
  const file = path.join(projectsDir, safeProjectName, "output", filename);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "最终音频文件未找到" });
  }
  res.download(file);
});

// 提供分段试听静态访问口，临时音频
router.get("/preview/:projectName/:filename", (req, res) => {
  const { projectName, filename } = req.params;
  const safeProjectName = projectName.trim().replace(/[\\/:*?"<>|]/g, "");
  const file = path.join(projectsDir, safeProjectName, "temp", filename);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "预览音频文件未找到" });
  }
  // 使用 res.sendFile 以便于 H5 标签直接播放
  res.sendFile(file);
});

module.exports = router;
