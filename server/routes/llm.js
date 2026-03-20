const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { autoAssignReferenceAudios, normalizeGender } = require("../services/autoCastingService");

const projectsDir = path.join(__dirname, "../data/projects");

// 辅助函数
function getCharactersFilePath(projectName) {
  if (!projectName) throw new Error("项目名称是必填项");
  const safeName = projectName.trim().replace(/[\\/:*?"<>|]/g, "");
  const dir = path.join(projectsDir, safeName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, "characters.json");
}

function getCharacters(projectName) {
  const filePath = getCharactersFilePath(projectName);
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data);
  }
  return {};
}

function saveCharacters(projectName, chars) {
  const filePath = getCharactersFilePath(projectName);
  fs.writeFileSync(filePath, JSON.stringify(chars, null, 2), "utf8");
}

// 大语言模型路由
router.post("/parse", async (req, res) => {
  try {
    const { text, projectName } = req.body;
    if (!text) {
      return res.status(400).json({ error: "请求体中缺失的文本" });
    }
    if (!projectName) {
      return res.status(400).json({ error: "请先选择或创建一个小说项目" });
    }

    // 假设通过第三方大模型 API
    // 你可以在 .env 中配置 API_KEY 和 MODEL_ENDPOINT
    const apiKey = process.env.LLM_API_KEY;
    const aiEndpoint = process.env.LLM_ENDPOINT || "https://api.deepseek.com/v1/chat/completions"; // 以 DeepSeek 为例

    // 构建 System Prompt 解决角色记忆、情景还原和听觉平滑
    const systemPrompt = `
      你是一个小说对话结构化提取助手。
      目标：将用户提供的长文本按对话和旁白进行拆解。
      
      【重要规则：第一人称视角转换】
      如果输入文本为第一人称视角（主角自述使用“我”），请务必通过上下文推断出主角的真实姓名（如通过他人对主角的称呼）。在提取的 text 内容（尤其是旁白）中，必须将代表主角的“我”全部替换为主角的真实姓名（例如将“我将公文包往桌子上一扔”替换为“江桥将公文包往桌子上一扔”），以保证转述视角的连贯性。
      
      【输出格式要求】
      要求返回的格式为严格的 JSON 数组（不要包装在 Markdown 代码块里，只有 JSON 字符串）。
      每个对象的格式为:
      {
         "type": "narration" | "dialogue",
         "role": "标准角色名（旁白请填 '旁白'，角色无论原文称谓怎么变，请统一为一个名字，如：张三）",
         "text": "提取的文本内容（注意：1. 必须完成上述的'我'替换为主角名字的逻辑；2. 旁白如果以动作描写结尾且直接引出后续对话，请在语境末尾自动补全发音引导词，比如'，开口问道：'，以此实现听觉平滑）",
         "emotion": "该句话的情绪（旁白必须为 'neutral'。如果是对话，请归纳为 happy, angry, sad, fearful, disgusted, melancholy, surprised, neutral(平静) 等英文发音情绪标识之一, 如果情绪未知默认使用 'neutral'）",
         "gender": "仅对 dialogue 必填：male|female|unknown；旁白固定填写 unknown"
      }
    `;

    const payload = {
      model: process.env.LLM_MODEL || "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.1, // 降低温度以保证结构稳定
    };

    const response = await axios.post(aiEndpoint, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });

    let rawResult = response.data.choices[0].message.content;

    // 清理可能附带的 Markdown json 标签
    rawResult = rawResult
      .replace(/\`\`\`json/g, "")
      .replace(/\`\`\`/g, "")
      .trim();

    const parsedData = JSON.parse(rawResult);
    const normalizedData = Array.isArray(parsedData)
      ? parsedData.map((item) => ({
          ...item,
          gender: item && item.type === "dialogue" ? normalizeGender(item.gender) : "unknown",
        }))
      : [];

    // --- 归一化校验：与本地角色字典同步 ---
    const localChars = getCharacters(projectName);
    let charsUpdated = false;

    normalizedData.forEach((item) => {
      // 若出现新角色，则缓存进去
      if (item.type === "dialogue" && item.role && item.role !== "旁白") {
        if (!localChars[item.role]) {
          // 初始化音色为空字符串或默认音色，留待后续配置
          localChars[item.role] = { voice: "default_voice", name: item.role };
          charsUpdated = true;
        }
      }
    });

    if (charsUpdated) {
      saveCharacters(projectName, localChars);
    }

    const provider = process.env.TTS_DEFAULT_PROVIDER || "siliconflow";
    const { cards, autoCasting } = autoAssignReferenceAudios({
      parsedCards: normalizedData,
      projectName,
      provider,
    });

    res.json({
      success: true,
      data: cards,
      characters: localChars,
      autoCasting,
    });
  } catch (error) {
    console.error("大语言模型解析错误:", error.message);
    if (error.response) {
      console.error("  → 响应状态码:", error.response.status);
      console.error("  → 响应数据:", JSON.stringify(error.response.data));
    }
    console.error("  → 请求地址:", process.env.LLM_ENDPOINT || "https://api.deepseek.com/v1/chat/completions");
    res.status(500).json({ error: `大语言模型解析错误: ${error.message}` });
  }
});

module.exports = router;
