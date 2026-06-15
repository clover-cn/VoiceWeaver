const path = require("path");
const fs = require("fs");
const axios = require("axios");

const audioRecordsPath = path.join(__dirname, "../../data/audio_records.json");
const legacyGlobalRolesPath = path.join(__dirname, "../../data/global_roles.json");
const projectsDir = path.join(__dirname, "../../data/projects");
const uploadsDir = path.join(__dirname, "../../uploads/reference_audios");

const MIME_BY_EXT = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function getAudioRecords() {
  return readJson(audioRecordsPath, []);
}

function sanitizeProjectName(projectName) {
  return String(projectName || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "");
}

function getGlobalRoles(projectName) {
  const safeProjectName = sanitizeProjectName(projectName);
  if (safeProjectName) {
    const projectGlobalRolesPath = path.join(projectsDir, safeProjectName, "global_roles.json");
    const projectRoles = readJson(projectGlobalRolesPath, null);
    if (projectRoles && typeof projectRoles === "object") return projectRoles;
  }
  return readJson(legacyGlobalRolesPath, {});
}

function normalizeAudioConfig(config) {
  if (!config) return null;
  if (typeof config === "string") return { id: config };
  if (typeof config === "object") return config;
  return null;
}

function resolveReferenceAudioId({ dialogue, projectName }) {
  const roleName = dialogue.role || "未知角色";
  const currentEmotion = dialogue.emotion || "neutral";
  const roleConfig = getGlobalRoles(projectName)[roleName] || {};

  const currentConfig = normalizeAudioConfig(dialogue.referenceAudio || roleConfig[currentEmotion]);
  if (currentConfig && currentConfig.id) return currentConfig.id;

  const neutralConfig = normalizeAudioConfig(roleConfig.neutral);
  if (neutralConfig && neutralConfig.id) return neutralConfig.id;

  const firstEmotion = Object.keys(roleConfig).find((emotion) => {
    const config = normalizeAudioConfig(roleConfig[emotion]);
    return config && config.id;
  });
  if (!firstEmotion) return null;

  const fallbackConfig = normalizeAudioConfig(roleConfig[firstEmotion]);
  return fallbackConfig ? fallbackConfig.id : null;
}

function getMimeType(fileName) {
  const ext = path.extname(fileName || "").toLowerCase();
  return MIME_BY_EXT[ext] || "audio/wav";
}

function buildDataVoice(record) {
  const filePath = path.join(uploadsDir, record.fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`MimoTTS 参考音频文件不存在: ${filePath}`);
  }

  const mimeType = getMimeType(record.originalName || record.fileName);
  const audioBase64 = fs.readFileSync(filePath).toString("base64");
  return `data:${mimeType};base64,${audioBase64}`;
}

function createWavBuffer(pcmBuffer, { sampleRate, channels, bitsPerSample }) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function generate({ dialogue, projectName, tempFilename, signal }) {
  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 MIMO_API_KEY，无法调用小米 MimoTTS。");
  }

  const stylePrompt = (process.env.MIMO_TTS_STYLE_PROMPT || "").trim();
  if (!stylePrompt) {
    throw new Error("缺少 MIMO_TTS_STYLE_PROMPT，请在 .env 中配置 MimoTTS 的自然语言风格指令。");
  }

  const audioId = resolveReferenceAudioId({ dialogue, projectName });
  if (!audioId) {
    throw new Error(`角色 "${dialogue.role || "未知角色"}" 尚未绑定参考音频，无法使用 MimoTTS 进行声音克隆。`);
  }

  const records = getAudioRecords();
  const record = records.find((item) => item.id === audioId);
  if (!record) {
    throw new Error(`MimoTTS 找不到参考音频记录: ${audioId}`);
  }

  const endpoint = process.env.MIMO_TTS_ENDPOINT || "https://api.xiaomimimo.com/v1/chat/completions";
  const model = process.env.MIMO_TTS_MODEL || "mimo-v2.5-tts-voiceclone";
  const sampleRate = parsePositiveInt(process.env.MIMO_TTS_SAMPLE_RATE, 24000);
  const voice = buildDataVoice(record);

  console.log("正在使用 MimoTTS 生成音频:", dialogue.text);

  const response = await axios.post(
    endpoint,
    {
      model,
      messages: [
        {
          role: "user",
          content: stylePrompt,
        },
        {
          role: "assistant",
          content: dialogue.text || "",
        },
      ],
      audio: {
        format: "pcm16",
        voice,
      },
      stream: false,
    },
    {
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      timeout: parsePositiveInt(process.env.MIMO_TTS_TIMEOUT_MS, 120000),
      signal,
    },
  );

  const audioData = response.data?.choices?.[0]?.message?.audio?.data;
  if (!audioData || typeof audioData !== "string") {
    const summary = {
      id: response.data?.id,
      model: response.data?.model,
      object: response.data?.object,
      finishReason: response.data?.choices?.[0]?.finish_reason,
      hasAudio: Boolean(response.data?.choices?.[0]?.message?.audio),
    };
    throw new Error(`MimoTTS 响应缺少 choices[0].message.audio.data: ${JSON.stringify(summary)}`);
  }

  const pcmBuffer = Buffer.from(audioData, "base64");
  const wavBuffer = createWavBuffer(pcmBuffer, {
    sampleRate,
    channels: 1,
    bitsPerSample: 16,
  });
  fs.writeFileSync(tempFilename, wavBuffer);
  console.log("MimoTTS 音频片段请求完成。");
}

module.exports = {
  generate,
};
