const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

// ─────────────────────────────────────────────
// 路径常量
// ─────────────────────────────────────────────
const dataDir = path.join(__dirname, "../data");
const cacheFilePath = path.join(dataDir, "listen_book_cache.json");

if (!fs.existsSync(cacheFilePath)) {
  fs.writeFileSync(cacheFilePath, "{}", "utf8");
}

// ─────────────────────────────────────────────
// 内存任务表（服务重启后丢失，已完成的靠 cache 恢复）
// ─────────────────────────────────────────────
const tasks = {};

function createCancelledError(message = "CANCELLED") {
  const err = new Error(message);
  err.cancelled = true;
  return err;
}

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────
function readCache() {
  try {
    const raw = fs.readFileSync(cacheFilePath, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeCache(data) {
  fs.writeFileSync(cacheFilePath, JSON.stringify(data, null, 2), "utf8");
}

function cacheKey(projectName, chapterIndex) {
  return `${projectName}__${chapterIndex}`;
}

// 本地服务基地址
function baseUrl() {
  return `http://localhost:${process.env.PORT || 3000}`;
}

function isCancelledError(err) {
  return Boolean(
    err &&
    (err.cancelled || err.code === "ERR_CANCELED" || err.name === "CanceledError")
  );
}

function cancelTask(task) {
  if (!task || task.phase === "done" || task.phase === "error" || task.phase === "cancelled") {
    return false;
  }
  task.cancelled = true;
  if (task.controller && !task.controller.signal.aborted) {
    task.controller.abort(createCancelledError());
  }
  return true;
}

function clearRunningCache(projectName, chapterIndex) {
  const cache = readCache();
  const key = cacheKey(projectName, chapterIndex);
  if (cache[key] && cache[key].phase !== "done") {
    delete cache[key];
    writeCache(cache);
  }
}

// ─────────────────────────────────────────────
// 核心 Pipeline（调用现有接口，异步后台执行）
// ─────────────────────────────────────────────

// 取消检查：若任务已被标记取消，清理 cache 并抛出中止错误
function checkCancelled(task, taskId, projectName, chapterIndex) {
  if (task.cancelled || task.controller?.signal?.aborted) {
    console.log(`[listenBook][${taskId}] 任务已取消，中止 Pipeline`);
    clearRunningCache(projectName, chapterIndex);
    throw createCancelledError();
  }
}

async function runPipeline(taskId, { projectName, chapterIndex, chapterUrl, chapterList }) {

  const task = tasks[taskId];
  const BASE = baseUrl();
  const signal = task.controller.signal;

  try {
    // ── 阶段 1: 预扫描（调用现有 /api/llm/prescan-characters）──
    task.phase = "prescan";
    task.progress = 0;
    console.log(`[listenBook][${taskId}] 预扫描开始`);

    const prescanCount = parseInt(process.env.PRESCAN_CHAPTER_COUNT || "10", 10);
    const scanChapters = chapterList.slice(chapterIndex, chapterIndex + prescanCount);

    // 并发获取预扫描章节正文
    const contentTexts = await Promise.all(
      scanChapters.map((chap, i) =>
        axios.get(`${BASE}/api/reader/getBookContent`, {
          params: { url: chap.bookUrl, index: chapterIndex + i },
          timeout: 30000,
          signal,
        })
          .then((r) => (r.data.isSuccess ? r.data.data || "" : ""))
          .catch(() => "")
      )
    );
    const combinedText = contentTexts.join("\n\n").trim();
    checkCancelled(task, taskId, projectName, chapterIndex); // 取消检查点

    if (combinedText) {
      await axios.post(`${BASE}/api/llm/prescan-characters`, {
        combinedText,
        projectName,
      }, { timeout: 120000, signal }).catch((e) => {
        if (isCancelledError(e)) throw createCancelledError();
        console.warn(`[listenBook][${taskId}] 预扫描失败，继续: ${e.message}`);
      });
      checkCancelled(task, taskId, projectName, chapterIndex); // 取消检查点
    }

    // ── 阶段 2 & 3: LLM 解析 + 自动分配参考音频（调用现有 /api/llm/parse）──
    task.phase = "parse";
    task.progress = 15;
    console.log(`[listenBook][${taskId}] LLM 解析开始`);

    const contentResp = await axios.get(`${BASE}/api/reader/getBookContent`, {
      params: { url: chapterUrl, index: chapterIndex },
      timeout: 30000,
      signal,
    });
    if (!contentResp.data.isSuccess) throw new Error("获取章节正文失败");
    const chapterText = contentResp.data.data || "";
    checkCancelled(task, taskId, projectName, chapterIndex); // 取消检查点

    task.phase = "assign";
    task.progress = 20;
    const parseResp = await axios.post(`${BASE}/api/llm/parse`, {
      text: chapterText,
      projectName,
    }, { timeout: 180000, signal });
    checkCancelled(task, taskId, projectName, chapterIndex); // 取消检查点

    if (!parseResp.data.success) throw new Error("LLM 解析失败");
    const cards = parseResp.data.data || [];
    console.log(`[listenBook][${taskId}] 解析完成，共 ${cards.length} 条`);

    // ── 阶段 4: TTS 逐条生成（调用现有 /api/tts/generate-single）──
    task.phase = "tts";
    task.progress = 35;
    // 直接挂到 task.segments 上，前端轮询可实时读取已完成的片段
    task.segments = [];
    console.log(`[listenBook][${taskId}] TTS 生成开始，共 ${cards.length} 条`);
    for (let i = 0; i < cards.length; i++) {
      checkCancelled(task, taskId, projectName, chapterIndex); // 每条生成前检查取消
      const card = cards[i];
      try {
        const ttsResp = await axios.post(`${BASE}/api/tts/generate-single`, {
          dialogue: card,
          projectName,
        }, { timeout: 60000, signal });

        task.segments.push({
          index: i,
          type: card.type,
          role: card.role || "旁白",
          emotion: card.emotion || "neutral",
          text: card.text || "",
          referenceAudio: card.referenceAudio || null,
          autoAssignedVoiceActor: card.autoAssignedVoiceActor || null,
          autoEmotionAudioMap: card.autoEmotionAudioMap || null,
          audioUrl: ttsResp.data.audioUrl || null,
        });
      } catch (e) {
        if (e.cancelled) throw e; // 取消错误直接向上抛
        console.warn(`[listenBook][${taskId}] 第 ${i} 条 TTS 失败: ${e.message}，跳过`);
        task.segments.push({
          index: i,
          type: card.type,
          role: card.role || "旁白",
          emotion: card.emotion || "neutral",
          text: card.text || "",
          referenceAudio: card.referenceAudio || null,
          autoAssignedVoiceActor: card.autoAssignedVoiceActor || null,
          autoEmotionAudioMap: card.autoEmotionAudioMap || null,
          audioUrl: null,
        });
      }
      task.progress = 35 + Math.round((i + 1) / cards.length * 60);
      task.ttsProgress = { current: i + 1, total: cards.length };
    }

    // ── 阶段 5: 完成 ──
    task.phase = "done";
    task.progress = 100;
    console.log(
      `[listenBook][${taskId}] 完成，成功生成 ${task.segments.filter((s) => s.audioUrl).length}/${cards.length} 条`
    );

    // 全部完成后写入 cache（前端检测到 done 再触发后续章节预缓存）
    const cache = readCache();
    cache[cacheKey(projectName, chapterIndex)] = {
      taskId,
      phase: "done",
      segments: task.segments,
      createdAt: new Date().toISOString(),
    };
    writeCache(cache);
  } catch (err) {
    if (isCancelledError(err)) {
      clearRunningCache(projectName, chapterIndex);
      task.phase = "cancelled";
      return;
    }
    console.error(`[listenBook][${taskId}] Pipeline 失败: ${err.message}`);
    task.phase = "error";
    task.error = err.message;

    clearRunningCache(projectName, chapterIndex);
  }
}

// ─────────────────────────────────────────────
// 路由接口
// ─────────────────────────────────────────────

/**
 * GET /api/listen-book/config
 * 暴露前端配置项
 */
router.get("/config", (req, res) => {
  res.json({
    success: true,
    prefetchCount: parseInt(process.env.LISTEN_PREFETCH_COUNT || "2", 10),
    prescanCount: parseInt(process.env.PRESCAN_CHAPTER_COUNT || "10", 10),
  });
});

/**
 * POST /api/listen-book/check
 * 检查章节是否已有完整 segments，防止重复生成
 * Body: { projectName, chapterIndex }
 */
router.post("/check", (req, res) => {
  const { projectName, chapterIndex } = req.body;
  if (!projectName || chapterIndex === undefined) {
    return res.status(400).json({ error: "缺少 projectName 或 chapterIndex" });
  }

  const key = cacheKey(projectName, chapterIndex);
  const cache = readCache();

  // 已完成
  if (cache[key] && cache[key].phase === "done") {
    return res.json({ exists: true, segments: cache[key].segments });
  }

  // 正在进行中
  if (cache[key] && cache[key].taskId) {
    const t = tasks[cache[key].taskId];
    if (t && t.phase !== "error" && t.phase !== "done" && t.phase !== "cancelled") {
      return res.json({ exists: false, taskId: cache[key].taskId, inProgress: true });
    }
    clearRunningCache(projectName, chapterIndex);
  }

  res.json({ exists: false });
});

/**
 * POST /api/listen-book/generate
 * 启动后台 Pipeline，立即返回 taskId
 * Body: { projectName, chapterIndex, chapterUrl, chapterList }
 */
router.post("/generate", (req, res) => {
  const { projectName, chapterIndex, chapterUrl, chapterList } = req.body;
  if (!projectName || chapterIndex === undefined || !chapterUrl || !Array.isArray(chapterList)) {
    return res.status(400).json({ error: "缺少必要参数：projectName / chapterIndex / chapterUrl / chapterList" });
  }

  const key = cacheKey(projectName, chapterIndex);
  const cache = readCache();

  // 已完成 → 直接返回
  if (cache[key] && cache[key].phase === "done") {
    return res.json({ taskId: cache[key].taskId, alreadyDone: true, segments: cache[key].segments });
  }

  // 正在进行中 → 返回已有 taskId
  if (cache[key] && cache[key].taskId) {
    const t = tasks[cache[key].taskId];
    if (t && t.phase !== "error" && t.phase !== "done" && t.phase !== "cancelled") {
      return res.json({ taskId: cache[key].taskId, inProgress: true });
    }
    clearRunningCache(projectName, chapterIndex);
  }

  // 新建任务
  const taskId = uuidv4();
  tasks[taskId] = {
    taskId,
    projectName,
    chapterIndex,
    phase: "waiting",
    progress: 0,
    segments: null,
    error: null,
    cancelled: false,
    controller: new AbortController(),
  };

  // 写入 cache 标记进行中（防并发重复触发）
  cache[key] = { taskId, phase: "running", createdAt: new Date().toISOString() };
  writeCache(cache);

  // 异步启动，不阻塞响应
  runPipeline(taskId, { projectName, chapterIndex, chapterUrl, chapterList }).catch((e) => {
    console.error(`[listenBook] Pipeline uncaught error: ${e.message}`);
  });

  res.json({ taskId });
});

/**
 * GET /api/listen-book/status/:taskId
 * 轮询任务状态
 */
router.get("/status/:taskId", (req, res) => {
  const { taskId } = req.params;
  const task = tasks[taskId];

  if (!task) {
    // 服务重启后内存丢失，从 cache 恢复
    const cache = readCache();
    const found = Object.values(cache).find((v) => v.taskId === taskId && v.phase === "done");
    if (found) {
      return res.json({ phase: "done", progress: 100, segments: found.segments });
    }
    return res.status(404).json({ error: "任务不存在" });
  }

  res.json({
    taskId,
    phase: task.phase,
    progress: task.progress,
    ttsProgress: task.ttsProgress || null,
    segments: task.segments,
    error: task.error || null,
  });
});

/**
 * POST /api/listen-book/cancel/:taskId
 * 前端退出/刷新时调用，标记任务取消，Pipeline 在下一检查点感知并中止
 */
router.post("/cancel/:taskId", (req, res) => {
  const { taskId } = req.params;
  const task = tasks[taskId];
  if (cancelTask(task)) {
    console.log(`[listenBook][${taskId}] 收到取消请求，将在下一检查点中止`);
  }
  res.json({ success: true });
});

router.post("/cancel", (req, res) => {
  const { projectName } = req.body || {};
  if (!projectName) {
    return res.status(400).json({ error: "缺少 projectName" });
  }

  const cancelledTaskIds = [];
  Object.values(tasks).forEach((task) => {
    if (task.projectName === projectName && cancelTask(task)) {
      cancelledTaskIds.push(task.taskId);
      console.log(`[listenBook][${task.taskId}] 收到按项目取消请求，将在下一检查点中止`);
    }
  });

  res.json({ success: true, cancelledTaskIds });
});

module.exports = router;
