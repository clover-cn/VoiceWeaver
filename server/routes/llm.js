const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { autoAssignReferenceAudios, normalizeGender } = require("../services/autoCastingService");
const { log } = require("console");

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

// 构建角色别名上下文信息
function buildCharacterContext(localChars) {
  const charNames = Object.keys(localChars).filter((name) => name !== "旁白");
  if (charNames.length === 0) return "";

  // 构建包含别名映射的角色信息
  const charLines = charNames.map((name) => {
    const charData = localChars[name];
    const aliases = charData.aliases && charData.aliases.length > 0 ? charData.aliases : [];
    let line = `- 「${name}」`;
    if (charData.description) {
      line += `（${charData.description}）`;
    }
    if (aliases.length > 0) {
      line += `，别名/小名有：${aliases.join("、")}`;
    }
    return line;
  });

  // 提取所有别名到大名的显式映射表，方便 LLM 直接查表
  const aliasMap = [];
  charNames.forEach((name) => {
    const charData = localChars[name];
    if (charData.aliases && charData.aliases.length > 0) {
      charData.aliases.forEach((alias) => {
        aliasMap.push(`"${alias}" → "${name}"`);
      });
    }
  });

  let context = `\n      【已知角色及别名映射】\n      本项目之前已出现的角色：\n      ${charLines.join("\n      ")}`;

  if (aliasMap.length > 0) {
    context += `\n\n      【别名→标准名 速查表】（在 role 字段中必须使用箭头右边的标准名）\n      ${aliasMap.join("\n      ")}`;
  }

  context += `\n\n      特别说明："我"也是一种别名。如果某角色的别名列表中包含"我"，说明该角色就是本文的第一人称主角。无论是在旁白还是对话的 text 中，都需要将"我"替换为该主角的标准大名（例如速查表中有 "我" → "江桥"，则旁白"我走上前去"应替换为"江桥走上前去"）。如果出现了其他角色的别名或小名，也请根据上面的速查表统一替换为对应的标准大名。`;

  return context;
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

    const localChars = getCharacters(projectName);
    const existingCharacterNames = Object.keys(localChars)
      .filter((name) => name !== "旁白")
      .join("、");

    const characterContext = buildCharacterContext(localChars);

    console.log("本项目之前已出现的角色有：", characterContext);
    // 假设通过第三方大模型 API
    // 你可以在 .env 中配置 API_KEY 和 MODEL_ENDPOINT
    const apiKey = process.env.LLM_API_KEY;
    const aiEndpoint = process.env.LLM_ENDPOINT || "https://api.deepseek.com/v1/chat/completions"; // 以 DeepSeek 为例

    // 构建 System Prompt 解决角色记忆、情景还原和听觉平滑
    const systemPrompt = `
      你是一个小说对话结构化提取助手。
      目标：将用户提供的长文本按对话和旁白进行拆解。
      ${characterContext}
      【重要规则：严格限定的视角转换】
      1. 仅限"我"字替换（对话和旁白的text中都适用）：如果输入文本为第一人称视角（主角自述使用"我"），请务必通过上下文或【已知角色及别名映射】（注意：如果某角色的别名中包含"我"，说明该角色就是第一人称主角）推断出主角的真实姓名，如果上下文和已知角色中都没有出现主角名请保持原文一致。在提取的 text 内容中（无论是旁白还是对话），**只允许将"我"这一个字替换为主角名称**，其他任何代词一律不动。例如旁白"我走上前去"替换为"江桥走上前去"，但"她看了看他"必须保持原样。对于对话角色(role字段)，如果出现了角色的别名或小名，请严格参照【别名→标准名 速查表】统一替换为标准大名。
      2. 禁止过度替换（非常重要）：在 text 内容中，除了"我"→主角名的替换外，**绝对不要**修改原文中的任何其他代词，包括但不限于"他"、"她"、"他们"、"她们"，也不要替换描述性称呼（如"丫头"、"那人"）。原文如果写的是"她带着一点儿小得意回道"，提取后必须原样保持为"她带着一点儿小得意回道"，切勿自作主张将其替换为具体名字或其它称呼！保持原文的原汁原味。
      3. 角色推断与情绪判断：请充分利用【已知角色及别名映射】中提供的角色描述信息（如果有），辅助判断该角色在当前对话中的语气、情绪以及可能的隐藏身份。

      【输出格式要求】
      要求返回的格式为严格的 JSON 对象（不要包装在 Markdown 代码块里，只有 JSON 字符串）。
      JSON 对象包含两个字段：
      {
        "dialogues": [
          {
             "type": "narration" | "dialogue",
             "role": "标准角色名（旁白请填 '旁白'，对话角色无论原文称谓怎么变，请统一为【别名→标准名 速查表】中的标准名，如原文写'小艺艺说'而速查表中有 "小艺艺" → "陈艺"，则 role 必须填 '陈艺'）",
             "text": "提取的文本内容（注意：1. 严格执行上述'仅替换我，不替换他/她'的规则；2. 旁白如果以动作描写结尾且直接引出后续对话，请在语境末尾自动补全发音引导词，比如'，开口问道：'，以此实现听觉平滑）",
             "emotion": "该句话的情绪（旁白必须为 'neutral'。如果是对话，必须从以下情绪选择： happy, angry, sad, fearful, disgusted, melancholy, surprised, neutral(平静) 英文发音情绪标识之一, 如果情绪没有匹配上默认使用 'neutral'）",
             "gender": "仅对 dialogue 必填：male|female|unknown；旁白固定填写 unknown"
          }
        ],
        "detectedAliases": {
          "标准角色名": ["在本段文本中发现的该角色的别名或称呼"],
          "说明": "请在这里列出你在解析过程中发现的所有别名映射关系。例如，如果文本是第一人称视角，主角通过上下文被确认为'江桥'，则应输出 { '江桥': ['我'] }。如果某角色在文中被称呼为'小艺艺'但你识别出标准名是'陈艺'，则输出 { '陈艺': ['小艺艺'] }。只列出本段文本中实际出现的别名，不要臆造。"
        }
      }
    `;

    const payload = {
      model: process.env.LLM_MODEL || "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.1, // 降低温度以保证结构稳定
      stream: true, // 开启流式输出
    };

    const response = await axios.post(aiEndpoint, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      responseType: "stream", // 接收流式响应
      timeout: 120000, // 设置超时时间为 120 秒 (120000 毫秒)
    });

    let rawResult = "";
    // 处理流式数据
    await new Promise((resolve, reject) => {
      let buffer = "";
      response.data.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop(); // 最后一行可能不完整，留到下一次处理
        // log("接收到流式数据块:", lines);
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine === "") continue;
          if (trimmedLine === "data: [DONE]") {
            resolve();
            return;
          }
          if (trimmedLine.startsWith("data: ")) {
            try {
              const data = JSON.parse(trimmedLine.slice(6));
              if (data.choices && data.choices.length > 0 && data.choices[0].delta && data.choices[0].delta.content) {
                const content = data.choices[0].delta.content;
                rawResult += content;
                process.stdout.write(content); // 在终端实时打印接收到的流式数据
              }
            } catch (e) {
              console.error("解析流式数据块失败:", e, trimmedLine);
            }
          }
        }
      });

      response.data.on("end", () => {
        console.log("\n--- 流式接收完成 ---");
        resolve();
      });
      response.data.on("error", reject);
    });

    // 清理可能附带的 Markdown json 标签
    rawResult = rawResult
      .replace(/\`\`\`json/g, "")
      .replace(/\`\`\`/g, "")
      .trim();
    const parsedData = JSON.parse(rawResult);

    // 兼容新格式（对象含 dialogues + detectedAliases）和旧格式（纯数组）
    let dialogueArray = [];
    let detectedAliases = {};

    if (Array.isArray(parsedData)) {
      // 旧格式兼容：LLM 直接返回数组
      dialogueArray = parsedData;
    } else if (parsedData && typeof parsedData === "object") {
      // 新格式：{ dialogues: [...], detectedAliases: { "角色名": ["别名"] } }
      dialogueArray = Array.isArray(parsedData.dialogues) ? parsedData.dialogues : [];
      detectedAliases = parsedData.detectedAliases && typeof parsedData.detectedAliases === "object" ? parsedData.detectedAliases : {};
      // 清理 detectedAliases 中的 "说明" 字段（LLM 可能照搬模板）
      delete detectedAliases["说明"];
    }

    const normalizedData = dialogueArray.map((item) => ({
      ...item,
      gender: item && item.type === "dialogue" ? normalizeGender(item.gender) : "unknown",
    }));

    // --- 归一化校验：与本地角色字典同步 ---
    let charsUpdated = false;
    normalizedData.forEach((item) => {
      // 若出现新角色，则缓存进去
      if (item.type === "dialogue" && item.role && item.role !== "旁白") {
        if (!localChars[item.role]) {
          // 初始化音色为空字符串或默认音色，留待后续配置；aliases 字段初始为空数组
          localChars[item.role] = { voice: "default_voice", name: item.role, aliases: [] };
          charsUpdated = true;
        } else if (!localChars[item.role].aliases) {
          // 兼容旧数据：为已有角色补充 aliases 字段
          localChars[item.role].aliases = [];
          charsUpdated = true;
        }
      }
    });

    // --- 自动合并 LLM 检测到的别名到角色字典 ---
    if (detectedAliases && Object.keys(detectedAliases).length > 0) {
      console.log("LLM 检测到的别名映射:", JSON.stringify(detectedAliases));
      Object.keys(detectedAliases).forEach((charName) => {
        const newAliases = detectedAliases[charName];
        if (!Array.isArray(newAliases) || newAliases.length === 0) return;
        // 确保角色存在
        if (!localChars[charName]) {
          localChars[charName] = { voice: "default_voice", name: charName, aliases: [] };
          charsUpdated = true;
        }
        if (!localChars[charName].aliases) {
          localChars[charName].aliases = [];
        }
        // 合并新别名（去重）
        const existingSet = new Set(localChars[charName].aliases);
        newAliases.forEach((alias) => {
          const trimmed = String(alias).trim();
          if (trimmed && !existingSet.has(trimmed) && trimmed !== charName) {
            localChars[charName].aliases.push(trimmed);
            existingSet.add(trimmed);
            charsUpdated = true;
            console.log(`  → 为角色「${charName}」自动添加别名：「${trimmed}」`);
          }
        });
      });
    }

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

// 预扫描第一阶段
router.post("/prescan-characters", async (req, res) => {
  try {
    const { combinedText, projectName } = req.body;
    if (!combinedText || !projectName) {
      return res.status(400).json({ error: "缺少 combinedText 或 projectName" });
    }

    const prescanModel = process.env.PRESCAN_LLM_MODEL || process.env.LLM_MODEL || "deepseek-chat";
    const apiKey = process.env.LLM_API_KEY;
    const aiEndpoint = process.env.LLM_ENDPOINT || "https://api.deepseek.com/v1/chat/completions";
    const chapterCount = process.env.PRESCAN_CHAPTER_COUNT || 10;

    const prescanPrompt = `
  你是一个专业的小说角色分析与指代消解专家。
  任务：阅读这篇小说的前 ${chapterCount} 章内容，提取所有核心角色的全局映射表。

  【重点要求】
  1. 发现真名：有些角色初期以特征代称（如"白裙姑娘", "丫头", "黑衣人"）出场，但在后续章节揭示了真名（如"陈艺"）。你需要将这些特征代称作为"别名"（aliases）绑定到她的真名下。
  2. 提取主角：如果小说是第一人称（使用"我"），请务必从上下文中推断出"我"的真实姓名。如果找到了，把"我"加入该角色的别名中。
  3. 无法确定真名的情况：如果在提供的文本中，该角色始终没有揭示真名，请为其创建一个具备辨识度的临时标准名（如"未命名_白裙姑娘"）。

  【过滤规则 - 非常重要】
  请忽略以下类型的“背景板角色”或“工具人”：
  1. 仅被提及名字但从未出场互动的角色（如回忆中的路人）。
  2. 仅执行单一功能性动作且没有后续剧情的龙套（如：服务员端茶、出租车司机开车、快递员送货），除非他们有持续的对话交流或对剧情产生重要影响。
  3. 仅作为群体出现的角色（如：围观群众、一群学生）。
  *判定标准：该角色是否至少有一句直接引语（对话），或者名字/代称在不同段落中重复出现超过3次。*

  【输出格式】
  必须返回严格的 JSON 格式（不要包含任何 Markdown 标记或代码块，纯 JSON）：
  {
    "characters": [
      {
        "standardName": "角色的真名或标准名（如：陈艺、江桥，如果实在没名字填：未命名_白裙姑娘）",
        "gender": "male | female | unknown",
        "aliases": ["文中所出现的所有对该角色的称呼、外号、特征代称", "小艺艺", "白裙姑娘", "丫头"],
        "description": "简短描述该角色的身份或外貌特征，不超过30字"
      }
    ]
  }
`;
    const response = await axios.post(
      aiEndpoint,
      {
        model: prescanModel,
        messages: [
          { role: "system", content: prescanPrompt },
          { role: "user", content: `小说前文内容如下：\n\n${combinedText}` },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 120000,
      },
    );

    let prescanResult = response.data.choices[0].message.content;
    prescanResult = prescanResult
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let parsedData;
    try {
      parsedData = JSON.parse(prescanResult);
    } catch (e) {
      console.error("Failed to parse JSON:", prescanResult);
      throw new Error("模型返回的数据不是有效的JSON格式");
    }

    const existingCharacters = getCharacters(projectName);
    let charsUpdated = false;

    if (parsedData.characters && Array.isArray(parsedData.characters)) {
      parsedData.characters.forEach((char) => {
        const stdName = char.standardName;
        if (!stdName) return;

        if (!existingCharacters[stdName]) {
          existingCharacters[stdName] = {
            name: stdName,
            gender: char.gender || "unknown",
            aliases: char.aliases || [],
            description: char.description || "",
            voice: "default_voice",
          };
          charsUpdated = true;
        } else {
          // 合并别名
          const mergedAliases = new Set([...(existingCharacters[stdName].aliases || []), ...(char.aliases || [])]);
          const mergedArray = Array.from(mergedAliases);
          if (mergedArray.length !== (existingCharacters[stdName].aliases || []).length) {
            existingCharacters[stdName].aliases = mergedArray;
            charsUpdated = true;
          }
          if (!existingCharacters[stdName].description && char.description) {
            existingCharacters[stdName].description = char.description;
            charsUpdated = true;
          }
        }
      });
    }

    if (charsUpdated) {
      saveCharacters(projectName, existingCharacters);
    }

    res.json({ success: true, data: existingCharacters });
  } catch (error) {
    console.error("预扫描失败:", error.message);
    if (error.response) {
      console.error("  → 响应数据:", JSON.stringify(error.response.data));
    }
    res.status(500).json({ error: "预扫描失败: " + error.message });
  }
});

module.exports = router;
