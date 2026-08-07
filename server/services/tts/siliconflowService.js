const path = require("path");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const audioRecordsPath = path.join(__dirname, "../../data/audio_records.json");
const projectsDir = path.join(__dirname, "../../data/projects");
const uploadsDir = path.join(__dirname, "../../uploads/reference_audios");

function getAudioRecords() {
  if (!fs.existsSync(audioRecordsPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(audioRecordsPath, "utf8"));
  } catch (e) {
    return [];
  }
}

function getGlobalRoles(projectName) {
  const safeProjectName = String(projectName || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "");

  // 手动绑定由 /api/audio/global-roles 保存到项目目录，优先读取项目配置。
  if (safeProjectName) {
    const projectGlobalRolesPath = path.join(projectsDir, safeProjectName, "global_roles.json");
    if (fs.existsSync(projectGlobalRolesPath)) {
      try {
        const projectRoles = JSON.parse(fs.readFileSync(projectGlobalRolesPath, "utf8"));
        if (projectRoles && typeof projectRoles === "object") return projectRoles;
      } catch (e) {
        console.warn(`项目 ${projectName} 的 global_roles.json 读取失败，将使用空配置:`, e.message);
      }
    }
  }

  return {};
}

function saveAudioRecords(records) {
  fs.writeFileSync(audioRecordsPath, JSON.stringify(records, null, 2), "utf8");
}

async function generate({ dialogue, projectName, tempFilename, localChars, signal }) {
  const API_KEY = process.env.SILICONFLOW_API_KEY;
  const AUDIO_MODEL = process.env.AUDIO_MODEL;

  const globalRoles = getGlobalRoles(projectName);
  const roleName = dialogue.role || "未知角色";
  const currentEmotion = dialogue.emotion || "neutral";

  const roleConfig = globalRoles[roleName] || {};
  let baseAudioId = null;
  
  if (roleConfig["neutral"]) {
    baseAudioId = typeof roleConfig["neutral"] === "string" ? roleConfig["neutral"] : roleConfig["neutral"].id;
  }
  if (!baseAudioId) {
    const firstAvailableEmotion = Object.keys(roleConfig).find((em) => {
      const conf = roleConfig[em];
      return conf && (typeof conf === "string" || conf.id);
    });
    if (firstAvailableEmotion) {
      const conf = roleConfig[firstAvailableEmotion];
      baseAudioId = typeof conf === "string" ? conf : conf.id;
    }
  }

  let currentConfig = dialogue.referenceAudio || roleConfig[currentEmotion];
  if (typeof currentConfig === "string") {
    currentConfig = { id: currentConfig };
  }

  let audioId = null;
  if (currentConfig && currentConfig.id) {
    audioId = currentConfig.id;
  } else if (baseAudioId) {
    audioId = baseAudioId;
  }

  if (!audioId) {
    throw new Error(`角色 "${roleName}" 尚未绑定参考音频，无法使用 SiliconFlow 进行声音克隆。请先在配置面板中为该角色选择参考音频。`);
  }

  const records = getAudioRecords();
  const record = records.find((r) => r.id === audioId);
  if (!record) {
    throw new Error(`SiliconFlow 找不到参考音频记录: ${audioId}`);
  }

  let targetVoice = String(record.siliconUri || "").trim();
  if (targetVoice) {
    console.log(`使用缓存的参考音频克隆音色: ${targetVoice}`);
  } else {
    // 没有缓存 URI 时上传参考音频；上传失败不能再静默回退到默认音色。
    const filePath = path.join(uploadsDir, record.fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`SiliconFlow 参考音频文件不存在: ${filePath}`);
    }
    if (!API_KEY) {
      throw new Error("缺少 SILICONFLOW_API_KEY，无法上传参考音频进行声音克隆。");
    }
    if (!AUDIO_MODEL) {
      throw new Error("缺少 AUDIO_MODEL，无法上传参考音频进行声音克隆。");
    }

    console.log(`正在上传参考音频至 SiliconFlow 进行发声克隆: ${record.fileName}`);
    try {
      const UPLOAD_URL = "https://api.siliconflow.cn/v1/uploads/audio/voice";
      const formData = new FormData();
      formData.append("file", fs.createReadStream(filePath));
      formData.append("model", AUDIO_MODEL);

      const safeVoiceName = "voice_" + audioId.replace(/-/g, "_");
      formData.append("customName", safeVoiceName);
      // 从音频记录中读取用户配置的参考文本
      const sampleText = record.sampleText || "";
      if (sampleText) {
        console.log("参考音频文本：", sampleText);
        formData.append("text", sampleText);
      }

      const uploadRes = await axios.post(UPLOAD_URL, formData, {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${API_KEY}`,
        },
      });

      targetVoice = String(uploadRes.data?.uri || "").trim();
      if (!targetVoice) {
        throw new Error("上传响应中缺少音色 URI");
      }

      // 将 SiliconFlow 返回的 URI 缓存到音频记录，后续请求直接复用。
      record.siliconUri = targetVoice;
      saveAudioRecords(records);
      console.log(`音色克隆成功并保存缓存，URI: ${targetVoice}`);
    } catch (err) {
      const detail = err.response ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`SiliconFlow 参考音频上传失败: ${detail}`);
    }
  }

  console.log("当前使用的音频模型为：", targetVoice);

  // 调用 SiliconFlow API 单句生成
  const TTS_URL = process.env.TTS_ENDPOINT || "https://api.siliconflow.cn/v1/audio/speech";

  const response = await axios({
    method: "POST",
    url: TTS_URL,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    data: {
      model: AUDIO_MODEL,
      input: dialogue.text,
      voice: targetVoice,
      response_format: "mp3",
      stream: true,
    },
    responseType: "stream",
    signal,
  });

  const writer = fs.createWriteStream(tempFilename);
  const cleanup = () => {
    response.data.destroy();
    writer.destroy();
    if (fs.existsSync(tempFilename)) {
      fs.unlinkSync(tempFilename);
    }
  };
  if (signal) {
    signal.addEventListener("abort", cleanup, { once: true });
  }

  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
    response.data.on("error", reject);
  });

  if (signal) {
    signal.removeEventListener("abort", cleanup);
  }
}

module.exports = {
  generate,
};
