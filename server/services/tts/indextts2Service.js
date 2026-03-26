const path = require("path");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const audioRecordsPath = path.join(__dirname, "../../data/audio_records.json");
const globalRolesPath = path.join(__dirname, "../../data/global_roles.json");
const uploadsDir = path.join(__dirname, "../../uploads/reference_audios");

function getAudioRecords() {
  if (!fs.existsSync(audioRecordsPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(audioRecordsPath, "utf8"));
  } catch (e) {
    return [];
  }
}

function getGlobalRoles() {
  if (!fs.existsSync(globalRolesPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(globalRolesPath, "utf8"));
  } catch (e) {
    return {};
  }
}

// 8维情绪映射表 [高兴, 愤怒, 悲伤, 害怕, 厌恶, 忧郁, 惊讶, 平静]
const EMOTION_MAP = {
  happy: 0,
  angry: 1,
  sad: 2,
  fearful: 3,
  disgusted: 4,
  melancholy: 5,
  surprised: 6,
  neutral: 7,
};

async function generate({ dialogue, projectName, tempFilename, localChars, signal }) {
  console.log("正在使用 IndexTTS2 模式生成音频:", dialogue.text);

  const UPLOAD_URL = process.env.TTS_ENDPOINT || "http://127.0.0.1:8000/api/tts/upload";
  const records = getAudioRecords();
  const globalRoles = getGlobalRoles();

  const roleName = dialogue.role || "未知角色";
  const currentEmotion = dialogue.emotion || "neutral";

  // 1. 获取主音色 (默认取 neutral 的配置。若没有，依次找当前角色的其他音频)
  let baseAudioId = null;
  const roleConfig = globalRoles[roleName] || {};

  if (roleConfig["neutral"] && roleConfig["neutral"].id) {
    baseAudioId = roleConfig["neutral"].id;
  } else {
    // 若没有 neutral 配置，优先寻找一个存在的基准作为主音色
    const firstAvailableEmotion = Object.keys(roleConfig).find((em) => roleConfig[em] && roleConfig[em].id);
    if (firstAvailableEmotion) {
      baseAudioId = roleConfig[firstAvailableEmotion].id;
    }
  }

  // 获取发音配置 (来源于前端传进来的 referenceAudio 对象)
  let currentConfig = dialogue.referenceAudio || roleConfig[currentEmotion];
  // 兼容旧版配置为字符串的情况
  if (typeof currentConfig === "string") {
    currentConfig = { id: currentConfig, mode: 1, emoWeight: 0.65 };
  }

  // 如果连当前角色的任何配置都没有，且也没有外部音频引用，则报错
  if (!baseAudioId && (!currentConfig || (!currentConfig.id && currentConfig.mode !== 3))) {
    throw new Error(`角色 "${roleName}" 尚未进行全局录音配置绑定，无法为其提取特征进行声音克隆。请在右侧配置面板中为该角色选择参考音频。`);
  }

  const formData = new FormData();
  formData.append("text", dialogue.text);

  if (!currentConfig || currentConfig.mode === 1 || !currentConfig.mode) {
    // 模式1：直接将当前选中的情感音频作为唯一参考音频
    const useAudioId = currentConfig && currentConfig.id ? currentConfig.id : baseAudioId;
    const speakerRecord = records.find((r) => r.id === useAudioId);
    if (!speakerRecord) throw new Error(`[同音色模式] 无法找到关联的角色录音文件记录! `);

    const filePath = path.join(uploadsDir, speakerRecord.fileName);
    if (!fs.existsSync(filePath)) throw new Error("服务器找不到此物理音频文件: " + filePath);

    console.log("IndexTTS2 [模式1 - 同音色参考] 使用:", speakerRecord.name);
    formData.append("spk_audio_file", fs.createReadStream(filePath));
  } else if (currentConfig.mode === 2) {
    // 模式2: baseAudio作为主音色, current.id作为情感参考
    const speakerRecord = records.find((r) => r.id === baseAudioId);
    if (!speakerRecord) throw new Error("无法提取该角色的主音色(基础记录)！");
    const spkFilePath = path.join(uploadsDir, speakerRecord.fileName);
    if (!fs.existsSync(spkFilePath)) throw new Error("主音色音频文件物理缺失!");

    formData.append("spk_audio_file", fs.createReadStream(spkFilePath));

    if (currentConfig.id) {
      const emoRecord = records.find((r) => r.id === currentConfig.id);
      if (emoRecord) {
        const emoFilePath = path.join(uploadsDir, emoRecord.fileName);
        if (fs.existsSync(emoFilePath)) {
          formData.append("emo_audio_file", fs.createReadStream(emoFilePath));
          formData.append("emo_alpha", currentConfig.emoWeight !== undefined ? currentConfig.emoWeight.toString() : "0.65");
        }
      }
    }
    console.log("IndexTTS2 [模式2 - 情感音频剥离] 音色使用:", speakerRecord.name, " 附加情感权重:", currentConfig.emoWeight);
  } else if (currentConfig.mode === 3) {
    // 模式3: baseAudio作为主音色, 强制注入8维数组参数实现高级控制
    const speakerRecord = records.find((r) => r.id === baseAudioId);
    if (!speakerRecord) throw new Error("无法提取该角色的主音色(基础记录)！");
    const spkFilePath = path.join(uploadsDir, speakerRecord.fileName);
    if (!fs.existsSync(spkFilePath)) throw new Error("主音色音频文件物理缺失!");

    formData.append("spk_audio_file", fs.createReadStream(spkFilePath));

    const weight = currentConfig.emoWeight !== undefined ? currentConfig.emoWeight : 0;
    const vectorIndex = EMOTION_MAP[currentEmotion] !== undefined ? EMOTION_MAP[currentEmotion] : 7;

    const vector = [0, 0, 0, 0, 0, 0, 0, 0];
    vector[vectorIndex] = weight;

    const baseConfig = roleConfig["neutral"] || {};
    const emoAlpha = baseConfig.emoAlpha !== undefined ? baseConfig.emoAlpha : 0.6;

    formData.append("emo_alpha", emoAlpha.toString());
    formData.append("emo_vector", JSON.stringify(vector));
    console.log("IndexTTS2 [模式3 - 向量控制] 音色使用:", speakerRecord.name, " 全局权重:", emoAlpha, " 发射情感向量:", vector);
  }

  try {
    const response = await axios.post(UPLOAD_URL, formData, {
      headers: {
        ...formData.getHeaders(),
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

    console.log("IndexTTS2 音频片段请求完成。");
  } catch (error) {
    let errorData = "";
    if (error.response && error.response.data) {
      if (typeof error.response.data.on === "function") {
        await new Promise((res) => {
          error.response.data.on("data", (chunk) => {
            errorData += chunk.toString();
          });
          error.response.data.on("end", res);
        });
      } else {
        errorData = JSON.stringify(error.response.data);
      }
      throw new Error("IndexTTS2 引擎抛出异常: " + errorData);
    }
    throw error;
  }
}

module.exports = {
  generate,
};
