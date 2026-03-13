const path = require("path");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const audioRecordsPath = path.join(__dirname, "../../data/audio_records.json");
const uploadsDir = path.join(__dirname, "../../uploads/reference_audios");

function getAudioRecords() {
  if (!fs.existsSync(audioRecordsPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(audioRecordsPath, "utf8"));
  } catch (e) {
    return [];
  }
}
function saveAudioRecords(records) {
  fs.writeFileSync(audioRecordsPath, JSON.stringify(records, null, 2), "utf8");
}

async function generate({ dialogue, projectName, tempFilename, localChars }) {
  let targetVoice = "fnlp/MOSS-TTSD-v0.5:alex";
  const API_KEY = process.env.SILICONFLOW_API_KEY;

  // --- 参考音频克隆优先 ---
  if (dialogue.type === "dialogue" && dialogue.referenceAudio) {
    const audioId = dialogue.referenceAudio;
    const records = getAudioRecords();
    const record = records.find((r) => r.id === audioId);

    if (record) {
      if (record.siliconUri) {
        targetVoice = record.siliconUri;
        console.log(`使用缓存的参考音频克隆音色: ${targetVoice}`);
      } else {
        // 不存在缓存 URI，通过 API 上传并创建
        const filePath = path.join(uploadsDir, record.fileName);
        if (fs.existsSync(filePath)) {
          console.log(`正在上传参考音频至 SiliconFlow 进行发声克隆: ${record.fileName}`);
          try {
            const UPLOAD_URL = "https://api.siliconflow.cn/v1/uploads/audio/voice";
            const formData = new FormData();
            formData.append("file", fs.createReadStream(filePath));
            formData.append("model", "IndexTeam/IndexTTS-2");

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

            if (uploadRes.data && uploadRes.data.uri) {
              targetVoice = uploadRes.data.uri;
              // 把 targetVoice 更新为 records
              record.siliconUri = targetVoice;
              saveAudioRecords(records);
              console.log(`音色克隆成功并保存缓存，URI: ${targetVoice}`);
            }
          } catch (err) {
            console.error("上传参考音频失败:", err.response ? JSON.stringify(err.response.data) : err.message);
          }
        } else {
          console.log(`找不到参考音频文件: ${filePath}`);
        }
      }
    }
  }

  // --- 若未使用参考音频或失败，则退回配置的音色或默认音色 ---
  if (targetVoice === "fnlp/MOSS-TTSD-v0.5:alex" && dialogue.type === "dialogue" && dialogue.role) {
    const matchedChar = localChars[dialogue.role];
    if (matchedChar && matchedChar.voice && matchedChar.voice !== "default_voice") {
      targetVoice = matchedChar.voice;
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
      model: "IndexTeam/IndexTTS-2",
      input: dialogue.text,
      voice: targetVoice,
      response_format: "mp3",
      stream: true,
    },
    responseType: "stream",
  });

  const writer = fs.createWriteStream(tempFilename);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

module.exports = {
  generate,
};
