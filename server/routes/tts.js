const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const { mergeAudioFiles, cleanUpTempFiles } = require("../utils/ffmpeg-merge");
const { v4: uuidv4 } = require("uuid");

const { generateAudio } = require("../services/tts/ttsFactory");
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

function isAbortError(error) {
  return Boolean(
    error &&
    (error.code === "ERR_CANCELED" ||
      error.name === "CanceledError" ||
      error.cancelled === true)
  );
}

// 1. 生成单条音频
router.post("/generate-single", async (req, res) => {
  const abortController = new AbortController();
  let requestClosed = false;
  let tempFilename = null;
  let responseFinished = false;
  const handleClientAbort = () => {
    requestClosed = true;
    if (!abortController.signal.aborted) {
      abortController.abort();
      console.log("[tts/generate-single] 客户端已断开，取消当前 TTS");
    }
  };
  req.on("aborted", handleClientAbort);
  res.on("finish", () => {
    responseFinished = true;
  });
  res.on("close", () => {
    if (!responseFinished) {
      handleClientAbort();
    }
  });
  try {
    const { dialogue, projectName } = req.body;
    const ttsProvider = process.env.TTS_DEFAULT_PROVIDER || "siliconflow";
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

    const fileName = `${uuidv4()}.mp3`;
    tempFilename = path.join(tempDir, fileName);

    // 将请求转发至 TTS 调度工厂
    await generateAudio(ttsProvider, {
      dialogue,
      projectName,
      tempFilename,
      localChars,
      signal: abortController.signal,
    });

    if (requestClosed) {
      if (fs.existsSync(tempFilename)) {
        fs.unlinkSync(tempFilename);
      }
      return;
    }

    res.json({
      success: true,
      message: "Audio generated successfully",
      fileName: fileName,
      audioUrl: `/api/tts/preview/${safeProjectName}/${fileName}`,
    });
  } catch (error) {
    if (isAbortError(error) || requestClosed) {
      if (tempFilename && fs.existsSync(tempFilename)) {
        fs.unlinkSync(tempFilename);
      }
      return;
    }
    console.error("TTS 生成单个错误:", error);
    res.status(500).json({ error: error.message || "生成过程中出现错误" });
  } finally {
    req.off("aborted", handleClientAbort);
  }
});

// 2. 合并多段音频
router.post("/merge", async (req, res) => {
  try {
    const { fileNames, projectName, pauseDuration } = req.body;
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
    const inputFiles = fileNames.map((name) => path.join(tempDir, name));

    // 检查文件是否存在
    for (const file of inputFiles) {
      if (!fs.existsSync(file)) {
        return res.status(404).json({ error: `文件未找到: ${path.basename(file)}` });
      }
    }

    const finalFileName = `novel_dubbing_${Date.now()}.mp3`;
    const finalFilePath = path.join(finalOutputDir, finalFileName);

    try {
      await mergeAudioFiles(inputFiles, finalFilePath, pauseDuration || 0);
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

// 获取当前 TTS 提供商
router.get("/provider", (req, res) => {
  const provider = process.env.TTS_DEFAULT_PROVIDER || "siliconflow";
  res.json({ success: true, provider });
});

module.exports = router;
