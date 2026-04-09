const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const {
  cacheKey,
  getProjectDir,
  readProjectListenCache,
  writeProjectListenCache,
  clearProjectListenCache,
  findListenCacheByTaskId,
  removePreviewAudioFile,
} = require("../services/listenBookCacheService");

// ─────────────────────────────────────────────
// 路径常量
// ─────────────────────────────────────────────
const dataDir = path.join(__dirname, "../data");

// ─────────────────────────────────────────────
// 内存任务表（服务重启后丢失，已完成的靠 cache 恢复）
// ─────────────────────────────────────────────
const tasks = {};

function createCancelledError(message = "CANCELLED") {
  const err = new Error(message);
  err.cancelled = true;
  return err;
}

function parseNonNegativeEnvInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(0, parsed);
}

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────
function getChapterEditsPath(projectName) {
  return path.join(getProjectDir(projectName), "reader_edits.json");
}

function readChapterEdits(projectName) {
  try {
    const fp = getChapterEditsPath(projectName);
    if (!fs.existsSync(fp)) return {};
    const raw = fs.readFileSync(fp, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeChapterEdits(projectName, edits) {
  const fp = getChapterEditsPath(projectName);
  fs.writeFileSync(fp, JSON.stringify(edits, null, 2), "utf8");
}

function applyChapterOverrides(cards, projectName, chapterIndex) {
  const chapterEdits = readChapterEdits(projectName);
  const current = chapterEdits[String(chapterIndex)];
  if (!current || !Array.isArray(current.segments)) {
    return cards || [];
  }

  return (cards || []).map((card, index) => {
    const override = current.segments[index];
    if (!override || typeof override !== "object") return card;
    const nextCard = { ...card };

    if (override.type) nextCard.type = override.type;
    if (override.role) nextCard.role = override.role;
    if (override.emotion) nextCard.emotion = override.emotion;
    if (typeof override.text === "string") nextCard.text = override.text;

    if (override.referenceAudio && typeof override.referenceAudio === "object") {
      nextCard.referenceAudio = override.referenceAudio;
    } else if (override.referenceAudio === null) {
      delete nextCard.referenceAudio;
    }

    if (override.autoEmotionAudioMap && typeof override.autoEmotionAudioMap === "object") {
      nextCard.autoEmotionAudioMap = override.autoEmotionAudioMap;
    }

    if (override.autoAssignedVoiceActor !== undefined) {
      nextCard.autoAssignedVoiceActor = override.autoAssignedVoiceActor;
    }

    if (override.manualAssigned !== undefined) {
      nextCard.manualAssigned = override.manualAssigned;
    }

    return nextCard;
  });
}

// 本地服务基地址
function baseUrl() {
  return `http://localhost:${process.env.PORT || 3000}`;
}

function getListenBookTtsTimeout() {
  const raw = process.env.LISTEN_BOOK_TTS_TIMEOUT_MS;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    // 听书任务是后台串行生成，默认不限制时长，仅依赖取消信号中断。
    return 0;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function isCancelledError(err) {
  return Boolean(err && (err.cancelled || err.code === "ERR_CANCELED" || err.name === "CanceledError"));
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
  const cache = readProjectListenCache(projectName);
  const key = cacheKey(projectName, chapterIndex);
  if (cache[key] && cache[key].phase !== "done") {
    delete cache[key];
    writeProjectListenCache(projectName, cache);
  }
}

function clearProjectCacheFromChapter(projectName, fromChapterIndex = 0) {
  return clearProjectListenCache(projectName, fromChapterIndex);
}

function normalizeSegments(segments, maxLength = Number.POSITIVE_INFINITY) {
  if (!Array.isArray(segments)) return [];

  return segments
    .filter((segment) => segment && Number.isInteger(segment.index) && segment.index >= 0 && segment.index < maxLength)
    .sort((a, b) => a.index - b.index)
    .map((segment) => ({ ...segment }));
}

function buildSegmentFromCard(card, index, audioUrl) {
  return {
    index,
    type: card.type,
    role: card.role || "旁白",
    emotion: card.emotion || "neutral",
    text: card.text || "",
    referenceAudio: card.referenceAudio || null,
    autoAssignedVoiceActor: card.autoAssignedVoiceActor || null,
    autoEmotionAudioMap: card.autoEmotionAudioMap || null,
    audioUrl: audioUrl || null,
  };
}

function buildSegmentForCache(card, index, currentSegment = null) {
  return {
    ...buildSegmentFromCard(card, index, currentSegment?.audioUrl || null),
    audioUrl: currentSegment?.audioUrl || null,
  };
}

function countCompletedSegments(segments) {
  return normalizeSegments(segments).filter((segment) => Boolean(segment.audioUrl)).length;
}

function cloneData(data) {
  return data ? JSON.parse(JSON.stringify(data)) : data;
}

function normalizeSegmentIndexes(indexes, maxLength) {
  return [...new Set((Array.isArray(indexes) ? indexes : []).map((index) => Number(index)).filter((index) => Number.isInteger(index) && index >= 0 && index < maxLength))]
    .sort((a, b) => a - b);
}

function normalizeEmotionKey(emotion) {
  const raw = String(emotion || "").trim().toLowerCase();
  const map = {
    happy: "happy",
    开心: "happy",
    高兴: "happy",
    angry: "angry",
    生气: "angry",
    愤怒: "angry",
    sad: "sad",
    悲伤: "sad",
    fearful: "fearful",
    害怕: "fearful",
    恐惧: "fearful",
    disgusted: "disgusted",
    厌恶: "disgusted",
    melancholy: "melancholy",
    忧郁: "melancholy",
    忧伤: "melancholy",
    surprised: "surprised",
    惊讶: "surprised",
    neutral: "neutral",
    平静: "neutral",
  };
  return map[raw] || "neutral";
}

function pickReferenceAudioByEmotion(emotionMap, emotion) {
  if (!emotionMap || typeof emotionMap !== "object") return null;
  const normalizedEmotion = normalizeEmotionKey(emotion);
  if (emotionMap[normalizedEmotion]) {
    return cloneData(emotionMap[normalizedEmotion]);
  }
  if (emotionMap.neutral) {
    return cloneData(emotionMap.neutral);
  }
  return null;
}

function readChapterCacheEntry(projectName, chapterIndex) {
  const key = cacheKey(projectName, chapterIndex);
  const cache = readProjectListenCache(projectName);
  return {
    key,
    cache,
    entry: cache[key] || null,
  };
}

function updateChapterCacheEntry(projectName, chapterIndex, updater) {
  const { key, cache, entry } = readChapterCacheEntry(projectName, chapterIndex);
  const nextEntry = updater(entry ? { ...entry } : null);
  if (!nextEntry) {
    delete cache[key];
  } else {
    cache[key] = nextEntry;
  }
  writeProjectListenCache(projectName, cache);
  return nextEntry;
}

function removeSegmentPreviewAudio(projectName, segment) {
  if (!segment?.audioUrl) return false;
  return removePreviewAudioFile(projectName, segment.audioUrl);
}

function updateRoleAudioForCard(card, roleUpdate) {
  if (!card || !roleUpdate?.role) return { changed: false, card };
  if (card.type !== "dialogue" || card.role !== roleUpdate.role) {
    return { changed: false, card };
  }

  const nextCard = { ...card };
  if (roleUpdate.emotionMap && typeof roleUpdate.emotionMap === "object") {
    nextCard.autoEmotionAudioMap = cloneData(roleUpdate.emotionMap);
    nextCard.referenceAudio = pickReferenceAudioByEmotion(roleUpdate.emotionMap, nextCard.emotion);
  } else if (roleUpdate.audioId) {
    nextCard.autoEmotionAudioMap = null;
    nextCard.referenceAudio = { id: roleUpdate.audioId, mode: 1, emoWeight: 0.65 };
  }

  if (roleUpdate.voiceActor) {
    nextCard.autoAssignedVoiceActor = roleUpdate.voiceActor;
  }
  nextCard.manualAssigned = true;

  const changed =
    JSON.stringify(card.referenceAudio || null) !== JSON.stringify(nextCard.referenceAudio || null) ||
    JSON.stringify(card.autoEmotionAudioMap || null) !== JSON.stringify(nextCard.autoEmotionAudioMap || null) ||
    (card.autoAssignedVoiceActor || null) !== (nextCard.autoAssignedVoiceActor || null) ||
    Boolean(card.manualAssigned) !== Boolean(nextCard.manualAssigned);

  return { changed, card: nextCard };
}

function applyRoleUpdateToCachedChapter(projectName, chapterIndex, roleUpdate) {
  const cacheEntry = readChapterCacheEntry(projectName, chapterIndex).entry;
  if (!cacheEntry || !Array.isArray(cacheEntry.parsedCards) || !cacheEntry.parsedCards.length) {
    return { targetIndexes: [], entry: cacheEntry };
  }

  const currentSegments = normalizeSegments(cacheEntry.segments, cacheEntry.parsedCards.length);
  const segmentMap = new Map(currentSegments.map((segment) => [segment.index, segment]));
  const targetIndexes = [];
  const nextParsedCards = cacheEntry.parsedCards.map((card, index) => {
    const result = updateRoleAudioForCard(card, roleUpdate);
    if (result.changed) {
      targetIndexes.push(index);
    }
    return result.card;
  });

  if (!targetIndexes.length) {
    return { targetIndexes: [], entry: cacheEntry };
  }

  const targetIndexSet = new Set(targetIndexes);
  const nextSegments = nextParsedCards.map((card, index) => {
    const cachedSegment = segmentMap.get(index);
    const nextSegment = buildSegmentForCache(card, index, cachedSegment);
    if (targetIndexSet.has(index)) {
      removeSegmentPreviewAudio(projectName, cachedSegment);
      nextSegment.audioUrl = null;
    }
    return nextSegment;
  });

  const updatedEntry = updateChapterCacheEntry(projectName, chapterIndex, (current) => ({
    ...(current || {}),
    parsedCards: nextParsedCards,
    segments: nextSegments,
    phase: "done",
    totalSegments: nextParsedCards.length,
    completedSegments: countCompletedSegments(nextSegments),
    updatedAt: new Date().toISOString(),
  }));

  return { targetIndexes, entry: updatedEntry };
}

async function regenerateSegmentIndexesForChapter(projectName, chapterIndex, indexes, { logPrefix = "listenBook:auto" } = {}) {
  const cacheEntry = readChapterCacheEntry(projectName, chapterIndex).entry;
  const parsedCards = Array.isArray(cacheEntry?.parsedCards) ? cacheEntry.parsedCards : [];
  if (!parsedCards.length) {
    return { segments: [], completedSegments: 0, regeneratedIndexes: [], failedIndexes: indexes || [] };
  }

  const targetIndexes = normalizeSegmentIndexes(indexes, parsedCards.length);
  if (!targetIndexes.length) {
    const currentSegments = normalizeSegments(cacheEntry?.segments, parsedCards.length);
    return {
      segments: currentSegments,
      completedSegments: countCompletedSegments(currentSegments),
      regeneratedIndexes: [],
      failedIndexes: [],
    };
  }

  let latestEntry = cacheEntry;
  const failedIndexes = [];

  for (const segmentIndex of targetIndexes) {
    const currentSegments = normalizeSegments(latestEntry?.segments, parsedCards.length);
    const previousSegment = currentSegments.find((segment) => segment.index === segmentIndex) || null;
    const previousAudioUrl = previousSegment?.audioUrl || null;
    const card = parsedCards[segmentIndex];

    try {
      const ttsResp = await axios.post(
        `${baseUrl()}/api/tts/generate-single`,
        {
          dialogue: card,
          projectName,
        },
        { timeout: getListenBookTtsTimeout() },
      );

      latestEntry = updateChapterCacheEntry(projectName, chapterIndex, (current) => {
        if (!current || !Array.isArray(current.parsedCards)) return current;
        const existingSegments = normalizeSegments(current.segments, current.parsedCards.length);
        const segmentMap = new Map(existingSegments.map((segment) => [segment.index, segment]));
        const nextSegments = current.parsedCards.map((item, index) => {
          const nextSegment = buildSegmentForCache(item, index, segmentMap.get(index));
          if (index === segmentIndex) {
            nextSegment.audioUrl = ttsResp.data.audioUrl || null;
          }
          return nextSegment;
        });

        return {
          ...current,
          phase: "done",
          segments: nextSegments,
          totalSegments: current.parsedCards.length,
          completedSegments: countCompletedSegments(nextSegments),
          updatedAt: new Date().toISOString(),
        };
      });

      if (previousAudioUrl && previousAudioUrl !== ttsResp.data.audioUrl) {
        removePreviewAudioFile(projectName, previousAudioUrl);
      }
    } catch (error) {
      failedIndexes.push(segmentIndex);
      console.warn(`[${logPrefix}] 章节 ${chapterIndex} 片段 ${segmentIndex} 重生成失败: ${error.message}`);
      latestEntry = updateChapterCacheEntry(projectName, chapterIndex, (current) => {
        if (!current || !Array.isArray(current.parsedCards)) return current;
        const existingSegments = normalizeSegments(current.segments, current.parsedCards.length);
        const segmentMap = new Map(existingSegments.map((segment) => [segment.index, segment]));
        const nextSegments = current.parsedCards.map((item, index) => {
          const nextSegment = buildSegmentForCache(item, index, segmentMap.get(index));
          if (index === segmentIndex) {
            nextSegment.audioUrl = null;
          }
          return nextSegment;
        });
        return {
          ...current,
          phase: "done",
          segments: nextSegments,
          totalSegments: current.parsedCards.length,
          completedSegments: countCompletedSegments(nextSegments),
          updatedAt: new Date().toISOString(),
        };
      });
    }
  }

  const finalSegments = normalizeSegments(latestEntry?.segments, parsedCards.length);
  return {
    segments: finalSegments,
    completedSegments: countCompletedSegments(finalSegments),
    regeneratedIndexes: targetIndexes.filter((index) => !failedIndexes.includes(index)),
    failedIndexes,
  };
}

// ─────────────────────────────────────────────
// 核心 Pipeline（调用现有接口，异步后台执行）
// ─────────────────────────────────────────────

// 取消检查：若任务已被标记取消，清理 cache 并抛出中止错误
function checkCancelled(task, taskId, projectName, chapterIndex) {
  if (task.cancelled || task.controller?.signal?.aborted) {
    console.log(`[listenBook][${taskId}] 任务已取消，中止 Pipeline`);
    throw createCancelledError();
  }
}

async function runPipeline(taskId, { projectName, chapterIndex, chapterUrl, chapterList }) {
  const task = tasks[taskId];
  const BASE = baseUrl();
  const signal = task.controller.signal;
  const ttsTimeout = getListenBookTtsTimeout();
  const cacheIdentity = { projectName, chapterIndex, chapterUrl };

  try {
    let cacheEntry = readChapterCacheEntry(projectName, chapterIndex).entry || {};
    let cards = Array.isArray(cacheEntry.parsedCards) ? applyChapterOverrides(cacheEntry.parsedCards, projectName, chapterIndex) : null;

    if (!cards) {
      // ── 阶段 1: 预扫描（调用现有 /api/llm/prescan-characters）──
      task.phase = "prescan";
      task.progress = 0;
      console.log('预扫描的章节数',process.env.PRESCAN_CHAPTER_COUNT);
      
      if (process.env.PRESCAN_CHAPTER_COUNT > 0) {
        console.log(`[listenBook][${taskId}] 预扫描开始`);
      }
      updateChapterCacheEntry(projectName, chapterIndex, (current) => ({
        ...(current || {}),
        ...cacheIdentity,
        taskId,
        phase: "prescan",
        createdAt: current?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      const prescanCount = parseNonNegativeEnvInt(process.env.PRESCAN_CHAPTER_COUNT, 10);
      const scanChapters = chapterList.slice(chapterIndex, chapterIndex + prescanCount);

      const contentTexts = await Promise.all(
        scanChapters.map((chap, i) =>
          axios
            .get(`${BASE}/api/reader/getBookContent`, {
              params: { url: chap.bookUrl, index: chapterIndex + i },
              timeout: 30000,
              signal,
            })
            .then((r) => (r.data.isSuccess ? r.data.data || "" : ""))
            .catch(() => ""),
        ),
      );
      const combinedText = contentTexts.join("\n\n").trim();
      checkCancelled(task, taskId, projectName, chapterIndex);

      if (combinedText) {
        await axios
          .post(
            `${BASE}/api/llm/prescan-characters`,
            {
              combinedText,
              projectName,
            },
            { timeout: 120000, signal },
          )
          .catch((e) => {
            if (isCancelledError(e)) throw createCancelledError();
            console.warn(`[listenBook][${taskId}] 预扫描失败，继续: ${e.message}`);
          });
        checkCancelled(task, taskId, projectName, chapterIndex);
      }

      // ── 阶段 2 & 3: LLM 解析 + 自动分配参考音频（调用现有 /api/llm/parse）──
      task.phase = "parse";
      task.progress = 15;
      console.log(`[listenBook][${taskId}] LLM 解析开始`);

      let chapterText = typeof cacheEntry.chapterText === "string" ? cacheEntry.chapterText : "";
      if (!chapterText) {
        const contentResp = await axios.get(`${BASE}/api/reader/getBookContent`, {
          params: { url: chapterUrl, index: chapterIndex },
          timeout: 30000,
          signal,
        });
        if (!contentResp.data.isSuccess) throw new Error("获取章节正文失败");
        chapterText = contentResp.data.data || "";
        updateChapterCacheEntry(projectName, chapterIndex, (current) => ({
          ...(current || {}),
          ...cacheIdentity,
          taskId,
          phase: "parse",
          chapterText,
          segments: normalizeSegments(current?.segments),
          createdAt: current?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
      }
      checkCancelled(task, taskId, projectName, chapterIndex);

      task.phase = "assign";
      task.progress = 20;
      const parseResp = await axios.post(
        `${BASE}/api/llm/parse`,
        {
          text: chapterText,
          projectName,
        },
        { timeout: 180000, signal },
      );
      checkCancelled(task, taskId, projectName, chapterIndex);

      if (!parseResp.data.success) throw new Error("LLM 解析失败");
      cards = applyChapterOverrides(parseResp.data.data || [], projectName, chapterIndex);
      cacheEntry = updateChapterCacheEntry(projectName, chapterIndex, (current) => ({
        ...(current || {}),
        ...cacheIdentity,
        taskId,
        phase: "assign",
        chapterText,
        parsedCards: cards,
        segments: normalizeSegments(current?.segments, cards.length),
        totalSegments: cards.length,
        createdAt: current?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      console.log(`[listenBook][${taskId}] 解析完成，共 ${cards.length} 条`);
    } else {
      console.log(`[listenBook][${taskId}] 命中 LLM 缓存，共 ${cards.length} 条`);
    }

    // ── 阶段 4: TTS 逐条生成（调用现有 /api/tts/generate-single）──
    task.phase = "tts";
    task.progress = 35;
    task.segments = normalizeSegments(task.segments || cacheEntry?.segments, cards.length);
    updateChapterCacheEntry(projectName, chapterIndex, (current) => ({
      ...(current || {}),
      ...cacheIdentity,
      taskId,
      phase: "tts",
      chapterText: current?.chapterText || cacheEntry?.chapterText || "",
      parsedCards: cards,
      segments: normalizeSegments(task.segments, cards.length),
      totalSegments: cards.length,
      createdAt: current?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    console.log(`[listenBook][${taskId}] TTS 生成开始，共 ${cards.length} 条`);

    const segmentMap = new Map(task.segments.map((segment) => [segment.index, segment]));
    for (let i = 0; i < cards.length; i++) {
      checkCancelled(task, taskId, projectName, chapterIndex);
      if (segmentMap.has(i)) {
        task.progress = 35 + Math.round(((i + 1) / cards.length) * 60);
        task.ttsProgress = { current: i + 1, total: cards.length };
        continue;
      }

      const card = cards[i];
      let nextSegment;
      try {
        const ttsResp = await axios.post(
          `${BASE}/api/tts/generate-single`,
          {
            dialogue: card,
            projectName,
          },
          { timeout: ttsTimeout, signal },
        );

        nextSegment = buildSegmentFromCard(card, i, ttsResp.data.audioUrl || null);
      } catch (e) {
        if (e.cancelled) throw e;
        if (e.code === "ECONNABORTED") {
          console.warn(
            `[listenBook][${taskId}] 第 ${i} 条 TTS 请求超时（timeout=${ttsTimeout}ms）: ${e.message}，跳过`,
          );
        } else {
          console.warn(`[listenBook][${taskId}] 第 ${i} 条 TTS 失败: ${e.message}，跳过`);
        }
        nextSegment = buildSegmentFromCard(card, i, null);
      }
      segmentMap.set(i, nextSegment);
      task.segments = normalizeSegments([...segmentMap.values()], cards.length);
      task.progress = 35 + Math.round(((i + 1) / cards.length) * 60);
      task.ttsProgress = { current: i + 1, total: cards.length };
      updateChapterCacheEntry(projectName, chapterIndex, (current) => ({
        ...(current || {}),
        ...cacheIdentity,
        taskId,
        phase: "tts",
        chapterText: current?.chapterText || cacheEntry?.chapterText || "",
        parsedCards: cards,
        segments: task.segments,
        totalSegments: cards.length,
        completedSegments: task.segments.length,
        createdAt: current?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    }

    // ── 阶段 5: 完成 ──
    task.phase = "done";
    task.progress = 100;
    console.log(`[listenBook][${taskId}] 完成，成功生成 ${task.segments.filter((s) => s.audioUrl).length}/${cards.length} 条`);

    updateChapterCacheEntry(projectName, chapterIndex, (current) => ({
      ...(current || {}),
      ...cacheIdentity,
      taskId,
      phase: "done",
      chapterText: current?.chapterText || cacheEntry?.chapterText || "",
      parsedCards: cards,
      segments: normalizeSegments(task.segments, cards.length),
      totalSegments: cards.length,
      completedSegments: cards.length,
      createdAt: current?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  } catch (err) {
    if (isCancelledError(err)) {
      task.phase = "cancelled";
      updateChapterCacheEntry(projectName, chapterIndex, (current) => ({
        ...(current || {}),
        ...cacheIdentity,
        taskId,
        phase: "cancelled",
        segments: normalizeSegments(task.segments, current?.totalSegments || Number.POSITIVE_INFINITY),
        createdAt: current?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      return;
    }
    console.error(`[listenBook][${taskId}] Pipeline 失败: ${err.message}`);
    task.phase = "error";
    task.error = err.message;
    updateChapterCacheEntry(projectName, chapterIndex, (current) => ({
      ...(current || {}),
      ...cacheIdentity,
      taskId,
      phase: "error",
      error: err.message,
      segments: normalizeSegments(task.segments, current?.totalSegments || Number.POSITIVE_INFINITY),
      createdAt: current?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
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
    prefetchCount: parseNonNegativeEnvInt(process.env.LISTEN_PREFETCH_COUNT, 2),
    prescanCount: parseNonNegativeEnvInt(process.env.PRESCAN_CHAPTER_COUNT, 10),
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
  const cache = readProjectListenCache(projectName);

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
  }

  res.json({
    exists: false,
    resumable: Boolean(cache[key]?.parsedCards || cache[key]?.chapterText || cache[key]?.segments?.length),
    phase: cache[key]?.phase || null,
    segments: normalizeSegments(cache[key]?.segments),
  });
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
  const cache = readProjectListenCache(projectName);

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
  }

  // 新建任务
  const taskId = uuidv4();
  const resumedSegments = normalizeSegments(cache[key]?.segments, cache[key]?.totalSegments || Number.POSITIVE_INFINITY);
  tasks[taskId] = {
    taskId,
    projectName,
    chapterIndex,
    phase: "waiting",
    progress: 0,
    segments: resumedSegments,
    error: null,
    cancelled: false,
    controller: new AbortController(),
  };

  // 写入 cache 标记进行中；若存在中断缓存则沿用其章节文本、LLM 结果与已完成片段。
  cache[key] = {
    ...(cache[key] || {}),
    taskId,
    phase: resumedSegments.length ? "resuming" : "running",
    chapterUrl,
    segments: resumedSegments,
    createdAt: cache[key]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeProjectListenCache(projectName, cache);

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
    const found = findListenCacheByTaskId(taskId);
    if (found) {
      const total =
        Number(found.totalSegments) ||
        (Array.isArray(found.parsedCards) ? found.parsedCards.length : 0) ||
        normalizeSegments(found.segments).length;
      const completed = normalizeSegments(found.segments, total || Number.POSITIVE_INFINITY).length;
      const progress = found.phase === "done" ? 100 : total > 0 ? 35 + Math.round((completed / total) * 60) : 0;
      return res.json({
        phase: found.phase,
        progress,
        ttsProgress: total ? { current: completed, total } : null,
        segments: normalizeSegments(found.segments, total || Number.POSITIVE_INFINITY),
        error: found.error || null,
      });
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

router.post("/invalidate-cache", (req, res) => {
  const { projectName, fromChapterIndex = 0 } = req.body || {};
  if (!projectName) {
    return res.status(400).json({ error: "缺少 projectName" });
  }

  const cancelledTaskIds = [];
  Object.values(tasks).forEach((task) => {
    if (task.projectName !== projectName) return;
    if (Number(task.chapterIndex) < Number(fromChapterIndex)) return;
    if (cancelTask(task)) {
      cancelledTaskIds.push(task.taskId);
    }
  });

  clearProjectCacheFromChapter(projectName, Number(fromChapterIndex) || 0);

  res.json({ success: true, cancelledTaskIds });
});

router.get("/chapter-edits", (req, res) => {
  const { projectName, chapterIndex } = req.query || {};
  if (!projectName || chapterIndex === undefined) {
    return res.status(400).json({ error: "缺少 projectName 或 chapterIndex" });
  }

  const chapterEdits = readChapterEdits(projectName);
  const current = chapterEdits[String(chapterIndex)] || null;
  res.json({
    success: true,
    data: current,
  });
});

router.post("/chapter-edits", (req, res) => {
  const { projectName, chapterIndex, segments, invalidatedSegmentIndexes = [] } = req.body || {};
  if (!projectName || chapterIndex === undefined || !Array.isArray(segments)) {
    return res.status(400).json({ error: "缺少 projectName / chapterIndex / segments" });
  }

  const invalidatedIndexSet = new Set(
    (Array.isArray(invalidatedSegmentIndexes) ? invalidatedSegmentIndexes : [])
      .map((index) => Number(index))
      .filter((index) => Number.isInteger(index) && index >= 0),
  );
  const chapterEdits = readChapterEdits(projectName);
  chapterEdits[String(chapterIndex)] = {
    updatedAt: new Date().toISOString(),
    segments: segments.map((segment) => ({
      type: segment.type || null,
      role: segment.role || null,
      emotion: segment.emotion || "neutral",
      text: typeof segment.text === "string" ? segment.text : "",
      referenceAudio: segment.referenceAudio || null,
      autoEmotionAudioMap: segment.autoEmotionAudioMap || null,
      autoAssignedVoiceActor: segment.autoAssignedVoiceActor || null,
      manualAssigned: Boolean(segment.manualAssigned),
    })),
  };
  writeChapterEdits(projectName, chapterEdits);

  updateChapterCacheEntry(projectName, Number(chapterIndex), (current) => {
    if (!current) return current;

    const parsedCards = segments.map((segment) => ({
      type: segment.type || null,
      role: segment.role || null,
      emotion: segment.emotion || "neutral",
      text: typeof segment.text === "string" ? segment.text : "",
      referenceAudio: segment.referenceAudio || null,
      autoEmotionAudioMap: segment.autoEmotionAudioMap || null,
      autoAssignedVoiceActor: segment.autoAssignedVoiceActor || null,
      manualAssigned: Boolean(segment.manualAssigned),
    }));

    const existingSegments = normalizeSegments(current.segments, parsedCards.length);
    const existingSegmentMap = new Map(existingSegments.map((segment) => [segment.index, segment]));
    invalidatedIndexSet.forEach((index) => {
      removeSegmentPreviewAudio(projectName, existingSegmentMap.get(index));
    });
    const nextSegments = parsedCards.map((card, index) => {
      const cachedSegment = existingSegmentMap.get(index);
      const nextSegment = buildSegmentForCache(card, index, cachedSegment);
      if (invalidatedIndexSet.has(index)) {
        nextSegment.audioUrl = null;
      }
      return nextSegment;
    });

    return {
      ...current,
      phase: "done",
      parsedCards,
      segments: nextSegments,
      totalSegments: parsedCards.length,
      completedSegments: countCompletedSegments(nextSegments),
      updatedAt: new Date().toISOString(),
    };
  });

  res.json({ success: true });
});

router.post("/auto-regenerate-after-edit", async (req, res) => {
  const {
    projectName,
    currentChapterIndex,
    invalidatedSegmentIndexes = [],
    futureRoleUpdate = null,
  } = req.body || {};

  if (!projectName || currentChapterIndex === undefined) {
    return res.status(400).json({ error: "缺少 projectName / currentChapterIndex" });
  }

  const normalizedChapterIndex = Number(currentChapterIndex);
  if (!Number.isInteger(normalizedChapterIndex) || normalizedChapterIndex < 0) {
    return res.status(400).json({ error: "currentChapterIndex 非法" });
  }

  const currentEntry = readChapterCacheEntry(projectName, normalizedChapterIndex).entry;
  const parsedCards = Array.isArray(currentEntry?.parsedCards) ? currentEntry.parsedCards : [];
  if (!parsedCards.length) {
    return res.status(409).json({ error: "当前章节尚未解析，无法自动重生成" });
  }

  const normalizedIndexes = normalizeSegmentIndexes(invalidatedSegmentIndexes, parsedCards.length);

  Object.values(tasks).forEach((task) => {
    if (task.projectName !== projectName) return;
    if (Number(task.chapterIndex) < normalizedChapterIndex) return;
    cancelTask(task);
  });

  try {
    const currentResult = await regenerateSegmentIndexesForChapter(projectName, normalizedChapterIndex, normalizedIndexes, {
      logPrefix: "listenBook:auto-current",
    });

    const cache = readProjectListenCache(projectName);
    const futureChapterIndexes = Object.keys(cache)
      .map((key) => {
        const [cachedProjectName, cachedChapterIndex] = key.split("__");
        if (cachedProjectName !== projectName) return null;
        const index = Number(cachedChapterIndex);
        if (!Number.isInteger(index) || index <= normalizedChapterIndex) return null;
        return index;
      })
      .filter((index) => index !== null)
      .sort((a, b) => a - b);

    const queuedFutureChapters = [];
    if (futureRoleUpdate?.role) {
      futureChapterIndexes.forEach((chapterIndex) => {
        const { targetIndexes } = applyRoleUpdateToCachedChapter(projectName, chapterIndex, futureRoleUpdate);
        if (targetIndexes.length) {
          queuedFutureChapters.push({ chapterIndex, targetIndexes });
        }
      });
    }

    res.json({
      success: true,
      currentChapterIndex: normalizedChapterIndex,
      segments: currentResult.segments,
      completedSegments: currentResult.completedSegments,
      regeneratedIndexes: currentResult.regeneratedIndexes,
      failedIndexes: currentResult.failedIndexes,
      queuedFutureChapters: queuedFutureChapters.map((item) => item.chapterIndex),
    });

    if (queuedFutureChapters.length) {
      setImmediate(async () => {
        for (const item of queuedFutureChapters) {
          const result = await regenerateSegmentIndexesForChapter(projectName, item.chapterIndex, item.targetIndexes, {
            logPrefix: "listenBook:auto-future",
          }).catch((error) => {
            console.warn(`[listenBook:auto-future] 章节 ${item.chapterIndex} 静默重生成失败: ${error.message}`);
            return null;
          });

          if (result?.failedIndexes?.length) {
            console.warn(
              `[listenBook:auto-future] 章节 ${item.chapterIndex} 仍有失败片段: ${result.failedIndexes.join(", ")}`,
            );
          }
        }
      });
    }
  } catch (error) {
    console.error("编辑后自动重生成失败:", error);
    return res.status(500).json({ error: error.message || "编辑后自动重生成失败" });
  }
});

router.post("/regenerate-segment", async (req, res) => {
  const { projectName, chapterIndex, segmentIndex } = req.body || {};
  if (!projectName || chapterIndex === undefined || segmentIndex === undefined) {
    return res.status(400).json({ error: "缺少 projectName / chapterIndex / segmentIndex" });
  }

  const normalizedChapterIndex = Number(chapterIndex);
  const normalizedSegmentIndex = Number(segmentIndex);
  if (!Number.isInteger(normalizedChapterIndex) || normalizedChapterIndex < 0) {
    return res.status(400).json({ error: "chapterIndex 非法" });
  }
  if (!Number.isInteger(normalizedSegmentIndex) || normalizedSegmentIndex < 0) {
    return res.status(400).json({ error: "segmentIndex 非法" });
  }

  const cacheEntry = readChapterCacheEntry(projectName, normalizedChapterIndex).entry;
  const parsedCards = Array.isArray(cacheEntry?.parsedCards) ? cacheEntry.parsedCards : [];
  if (!parsedCards.length) {
    return res.status(409).json({ error: "当前章节尚未解析，请先生成听书" });
  }

  const card = parsedCards[normalizedSegmentIndex];
  if (!card) {
    return res.status(404).json({ error: "目标片段不存在" });
  }

  try {
    const currentSegments = normalizeSegments(cacheEntry?.segments, parsedCards.length);
    const previousSegment = currentSegments.find((segment) => segment.index === normalizedSegmentIndex) || null;
    const previousAudioUrl = previousSegment?.audioUrl || null;
    const ttsResp = await axios.post(
      `${baseUrl()}/api/tts/generate-single`,
      {
        dialogue: card,
        projectName,
      },
      { timeout: getListenBookTtsTimeout() },
    );

    const updatedEntry = updateChapterCacheEntry(projectName, normalizedChapterIndex, (current) => {
      if (!current || !Array.isArray(current.parsedCards)) return current;

      const nextParsedCards = current.parsedCards.map((item, index) =>
        index === normalizedSegmentIndex ? { ...card } : { ...item },
      );
      const currentSegments = normalizeSegments(current.segments, nextParsedCards.length);
      const segmentMap = new Map(currentSegments.map((segment) => [segment.index, segment]));
      const nextSegments = nextParsedCards.map((item, index) => {
        const nextSegment = buildSegmentForCache(item, index, segmentMap.get(index));
        if (index === normalizedSegmentIndex) {
          nextSegment.audioUrl = ttsResp.data.audioUrl || null;
        }
        return nextSegment;
      });

      return {
        ...current,
        phase: "done",
        parsedCards: nextParsedCards,
        segments: nextSegments,
        totalSegments: nextParsedCards.length,
        completedSegments: countCompletedSegments(nextSegments),
        updatedAt: new Date().toISOString(),
      };
    });

    if (previousAudioUrl && previousAudioUrl !== ttsResp.data.audioUrl) {
      removePreviewAudioFile(projectName, previousAudioUrl);
    }

    const nextSegments = normalizeSegments(updatedEntry?.segments, parsedCards.length);
    return res.json({
      success: true,
      segment: nextSegments.find((segment) => segment.index === normalizedSegmentIndex) || null,
      segments: nextSegments,
      completedSegments: countCompletedSegments(nextSegments),
    });
  } catch (error) {
    console.error("单段音频重生成失败:", error.message);
    return res.status(500).json({ error: error.message || "单段音频重生成失败" });
  }
});

module.exports = router;
