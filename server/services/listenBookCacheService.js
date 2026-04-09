const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "../data");
const projectsDir = path.join(dataDir, "projects");
const legacyCachePath = path.join(dataDir, "listen_book_cache.json");
const cacheFileName = "listen_book_cache.json";
const previewRoutePrefix = "/api/tts/preview/";

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function sanitizeProjectName(projectName) {
  return String(projectName || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "");
}

function cacheKey(projectName, chapterIndex) {
  return `${projectName}__${chapterIndex}`;
}

function getProjectDir(projectName) {
  const safeProjectName = sanitizeProjectName(projectName);
  const projectDir = path.join(projectsDir, safeProjectName);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  return projectDir;
}

function getProjectListenCachePath(projectName) {
  return path.join(getProjectDir(projectName), cacheFileName);
}

function getProjectTempDir(projectName) {
  return path.join(getProjectDir(projectName), "temp");
}

function resolvePreviewAudioPath(projectName, audioUrl) {
  if (!audioUrl) return null;

  const safeProjectName = sanitizeProjectName(projectName);
  const normalizedUrl = String(audioUrl).split("?")[0];
  const expectedPrefix = `${previewRoutePrefix}${safeProjectName}/`;
  if (!normalizedUrl.startsWith(expectedPrefix)) return null;

  const fileName = path.basename(normalizedUrl);
  if (!fileName) return null;
  return path.join(getProjectTempDir(projectName), fileName);
}

function removePreviewAudioFile(projectName, audioUrl) {
  const filePath = resolvePreviewAudioPath(projectName, audioUrl);
  if (!filePath || !fs.existsSync(filePath)) return false;

  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    console.warn(`删除听书缓存音频失败: ${filePath}`, error.message);
    return false;
  }
}

function collectEntryAudioUrls(entry) {
  if (!entry || !Array.isArray(entry.segments)) return [];
  return entry.segments.map((segment) => segment?.audioUrl).filter(Boolean);
}

function readLegacyCache() {
  return readJson(legacyCachePath, {});
}

function writeLegacyCache(cache) {
  writeJson(legacyCachePath, cache);
}

function pickLegacyProjectCache(projectName) {
  const output = {};
  const cache = readLegacyCache();

  Object.keys(cache).forEach((key) => {
    const [cachedProjectName] = key.split("__");
    if (cachedProjectName === projectName) {
      output[key] = cache[key];
    }
  });

  return output;
}

function removeLegacyProjectCache(projectName) {
  if (!fs.existsSync(legacyCachePath)) return false;

  const cache = readLegacyCache();
  let changed = false;

  Object.keys(cache).forEach((key) => {
    const [cachedProjectName] = key.split("__");
    if (cachedProjectName !== projectName) return;
    delete cache[key];
    changed = true;
  });

  if (changed) {
    writeLegacyCache(cache);
  }

  return changed;
}

function readProjectListenCache(projectName) {
  const cachePath = getProjectListenCachePath(projectName);
  if (fs.existsSync(cachePath)) {
    return readJson(cachePath, {});
  }

  const migratedCache = pickLegacyProjectCache(projectName);
  if (Object.keys(migratedCache).length > 0) {
    writeJson(cachePath, migratedCache);
    removeLegacyProjectCache(projectName);
    return migratedCache;
  }

  return {};
}

function writeProjectListenCache(projectName, cache) {
  const cachePath = getProjectListenCachePath(projectName);
  writeJson(cachePath, cache);
  removeLegacyProjectCache(projectName);
}

function clearProjectListenCache(projectName, fromChapterIndex = 0) {
  const cache = readProjectListenCache(projectName);
  let changed = false;
  const staleAudioUrls = new Set();

  Object.keys(cache).forEach((key) => {
    const [cachedProjectName, cachedChapterIndex] = key.split("__");
    if (cachedProjectName !== projectName) return;
    const idx = Number(cachedChapterIndex);
    if (!Number.isFinite(idx) || idx < fromChapterIndex) return;
    collectEntryAudioUrls(cache[key]).forEach((audioUrl) => staleAudioUrls.add(audioUrl));
    delete cache[key];
    changed = true;
  });

  staleAudioUrls.forEach((audioUrl) => {
    removePreviewAudioFile(projectName, audioUrl);
  });

  if (changed) {
    writeProjectListenCache(projectName, cache);
  } else {
    removeLegacyProjectCache(projectName);
  }

  return changed;
}

function findListenCacheByTaskId(taskId, { phase } = {}) {
  const legacyCache = readLegacyCache();
  const legacyMatch = Object.values(legacyCache).find((item) => {
    if (item.taskId !== taskId) return false;
    if (phase && item.phase !== phase) return false;
    return true;
  });
  if (legacyMatch) return legacyMatch;

  if (!fs.existsSync(projectsDir)) return null;

  const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const entry of projectDirs) {
    const cachePath = path.join(projectsDir, entry.name, cacheFileName);
    const projectCache = readJson(cachePath, {});
    const match = Object.values(projectCache).find((item) => {
      if (item.taskId !== taskId) return false;
      if (phase && item.phase !== phase) return false;
      return true;
    });
    if (match) {
      return match;
    }
  }

  return null;
}

module.exports = {
  cacheKey,
  getProjectDir,
  getProjectListenCachePath,
  readProjectListenCache,
  writeProjectListenCache,
  clearProjectListenCache,
  findListenCacheByTaskId,
  removePreviewAudioFile,
};
