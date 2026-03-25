const express = require("express");
const axios = require("axios");

const router = express.Router();

// 目标基础 URL
const TARGET_BASE_URL = "http://154.58.233.231:9080/reader3";

/**
 * 搜索小说接口
 * 参数: key, concurrentCount (默认4), lastIndex (默认-1)
 */
router.get("/searchBookMultiSSE", async (req, res) => {
  try {
    const { key, concurrentCount = 4, lastIndex = -1 } = req.query;

    if (!key) {
      return res.status(400).json({ error: "缺少必需的查询参数: key" });
    }

    const response = await axios.get(`${TARGET_BASE_URL}/searchBookMultiSSE`, {
      params: {
        key,
        concurrentCount,
        lastIndex,
      },
    });

    // 第三方接口返回的是 SSE 流格式（以 `data: {...}` 开头的文本）
    // 我们在这里将它解析成普通的 JSON 对象返回给前端
    const rawText = response.data;
    const lines = rawText.split(/\r?\n/);

    let resultList = [];
    let finalLastIndex = -1;
    console.log('====', rawText);
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const jsonStr = line.replace("data: ", "").trim();
        if (jsonStr) {
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.data && Array.isArray(parsed.data)) {
              resultList.push(...parsed.data);
            }
            if (parsed.lastIndex !== undefined) {
              finalLastIndex = parsed.lastIndex;
            }
          } catch (e) {
            // 解析失败的数据块忽略不计
          }
        }
      }
    }

    // 将整个数据作为聚合的 JSON 返回给前端
    res.json({
      lastIndex: finalLastIndex,
      data: resultList
    });
  } catch (error) {
    console.error("/searchBookMultiSSE 代理出错：", error.message);
    res.status(500).json({
      error: "代理错误",
      details: error.response?.data || error.message,
    });
  }
});

/**
 * 获取章节列表接口
 * 参数: url, bookSourceUrl
 */
router.get("/getChapterList", async (req, res) => {
  try {
    const { url, bookSourceUrl } = req.query;

    if (!url || !bookSourceUrl) {
      return res.status(400).json({ error: "缺少必需的查询参数：url、bookSourceUrl" });
    }

    const response = await axios.get(`${TARGET_BASE_URL}/getChapterList`, {
      params: {
        url,
        bookSourceUrl,
      },
    });

    res.json(response.data);
  } catch (error) {
    console.error("/getChapterList 代理出错：", error.message);
    res.status(500).json({
      error: "代理错误",
      details: error.response?.data || error.message,
    });
  }
});

/**
 * 获取小说正文接口
 * 参数: url, index
 */
router.get("/getBookContent", async (req, res) => {
  try {
    const { url, index = 0 } = req.query;

    if (!url) {
      return res.status(400).json({ error: "缺少必需的查询参数: url" });
    }

    const response = await axios.get(`${TARGET_BASE_URL}/getBookContent`, {
      params: {
        url,
        index,
      },
    });

    res.json(response.data);
  } catch (error) {
    console.error("/getBookContent 代理出错：", error.message);
    res.status(500).json({
      error: "代理错误",
      details: error.response?.data || error.message,
    });
  }
});

module.exports = router;
