const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "../data");
const projectsDir = path.join(dataDir, "projects");
const audioRecordsPath = path.join(dataDir, "audio_records.json");

const SUPPORTED_PROVIDERS = new Set(["indextts2", "siliconflow"]);

const EMOTION_ALIASES = {
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
  common: "common",
  未知: "common",
};

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (error) {
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

function normalizeEmotion(emotion) {
  if (!emotion) return "neutral";
  return EMOTION_ALIASES[String(emotion).trim().toLowerCase()] || "neutral";
}

function normalizeGender(gender) {
  const val = String(gender || "")
    .trim()
    .toLowerCase();
  if (val === "男" || val === "male" || val === "m") return "male";
  if (val === "女" || val === "female" || val === "f") return "female";
  return "unknown";
}

function parseAudioRecordName(recordName) {
  const name = String(recordName || "").trim();
  if (!name) return null;

  const segs = name.split("-").map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) return null;

  const voiceActor = segs[0];
  const second = segs[1];

  if (second === "旁白" || second.toLowerCase() === "narration") {
    return {
      voiceActor,
      emotion: "narration",
      gender: normalizeGender(segs[2]),
    };
  }

  return {
    voiceActor,
    emotion: normalizeEmotion(second),
    gender: normalizeGender(segs[2]),
  };
}

function getRoleGenderStats(cards) {
  const stats = {};
  for (const item of cards || []) {
    if (!item || item.type !== "dialogue" || !item.role || item.role === "旁白") continue;
    if (!stats[item.role]) {
      stats[item.role] = { male: 0, female: 0, unknown: 0 };
    }
    const g = normalizeGender(item.gender);
    stats[item.role][g] += 1;
  }
  return stats;
}

function decideRoleGender(genderStats) {
  const result = {};
  Object.keys(genderStats || {}).forEach((role) => {
    const s = genderStats[role];
    if (s.female > s.male && s.female > 0) {
      result[role] = "female";
      return;
    }
    if (s.male > s.female && s.male > 0) {
      result[role] = "male";
      return;
    }
    result[role] = "unknown";
  });
  return result;
}

function getProjectCastingPath(projectName) {
  const safe = sanitizeProjectName(projectName);
  const projectDir = path.join(projectsDir, safe);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  return path.join(projectDir, "voice_casting.json");
}

function loadProjectCasting(projectName) {
  const fp = getProjectCastingPath(projectName);
  const data = readJson(fp, {});
  return {
    narratorAudioId: data.narratorAudioId || null,
    roleAssignments: data.roleAssignments && typeof data.roleAssignments === "object" ? data.roleAssignments : {},
  };
}

function saveProjectCasting(projectName, casting) {
  const fp = getProjectCastingPath(projectName);
  writeJson(fp, {
    version: 2,
    updatedAt: new Date().toISOString(),
    narratorAudioId: casting.narratorAudioId || null,
    roleAssignments: casting.roleAssignments || {},
  });
}

function buildVoicePool(records) {
  const actorPool = {};
  const narratorCandidates = [];
  const sorted = [...(records || [])].sort((a, b) => new Date(b.createTime || 0) - new Date(a.createTime || 0));

  for (const rec of sorted) {
    const parsed = parseAudioRecordName(rec.name);
    if (!parsed) continue;

    if (parsed.emotion === "narration") {
      narratorCandidates.push(rec);
      continue;
    }

    if (parsed.gender === "unknown") continue;

    if (!actorPool[parsed.voiceActor]) {
      actorPool[parsed.voiceActor] = {
        gender: parsed.gender,
        emotions: {},
      };
    }

    const actor = actorPool[parsed.voiceActor];
    if (!actor.emotions[parsed.emotion]) {
      actor.emotions[parsed.emotion] = rec.id;
    }
  }

  return {
    actorPool,
    narratorCandidates,
  };
}

function pickNewActor(roleGender, actorPool, usedActors) {
  if (roleGender !== "male" && roleGender !== "female") return null;

  const candidates = Object.keys(actorPool).filter((actorName) => {
    const actor = actorPool[actorName];
    return actor && actor.gender === roleGender && !usedActors.has(actorName);
  });

  if (candidates.length === 0) return null;
  return candidates[0];
}

function attachAutoCastingToCards(cards, casting, actorPool) {
  const output = [];

  for (const item of cards || []) {
    const card = { ...item };

    if (card.type === "narration" || card.role === "旁白") {
      if (casting.narratorAudioId) {
        card.referenceAudio = {
          id: casting.narratorAudioId,
          mode: 1,
          emoWeight: 0.65,
        };
      } else {
        delete card.referenceAudio;
      }
      output.push(card);
      continue;
    }

    const roleCasting = casting.roleAssignments[card.role];
    if (!roleCasting || !roleCasting.voiceActor) {
      delete card.referenceAudio;
      output.push(card);
      continue;
    }

    const actor = actorPool[roleCasting.voiceActor];
    if (!actor) {
      delete card.referenceAudio;
      output.push(card);
      continue;
    }

    const emo = normalizeEmotion(card.emotion);
    const audioId = actor.emotions[emo];
    card.autoAssignedVoiceActor = roleCasting.voiceActor;
    card.autoEmotionAudioMap = {};

    Object.keys(actor.emotions).forEach((k) => {
      card.autoEmotionAudioMap[k] = {
        id: actor.emotions[k],
        mode: 1,
        emoWeight: 0.65,
      };
    });

    if (audioId) {
      card.referenceAudio = {
        id: audioId,
        mode: 1,
        emoWeight: 0.65,
      };
    } else {
      delete card.referenceAudio;
    }

    output.push(card);
  }

  return output;
}

function autoAssignReferenceAudios({ parsedCards, projectName, provider }) {
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return {
      cards: parsedCards || [],
      autoCasting: {
        enabled: false,
        reason: `provider_not_supported:${provider}`,
      },
    };
  }

  const records = readJson(audioRecordsPath, []);
  const { actorPool, narratorCandidates } = buildVoicePool(records);
  const roleGenderStats = getRoleGenderStats(parsedCards);
  const roleGenders = decideRoleGender(roleGenderStats);

  const casting = loadProjectCasting(projectName);
  const usedActors = new Set();
  const validatedRoleAssignments = {};

  Object.keys(casting.roleAssignments || {}).forEach((role) => {
    const conf = casting.roleAssignments[role];
    if (!conf || !conf.voiceActor) return;
    const actor = actorPool[conf.voiceActor];
    if (!actor) return;
    const expectedGender = roleGenders[role];
    if (expectedGender !== "unknown" && actor.gender !== expectedGender) return;
    if (usedActors.has(conf.voiceActor)) return;
    validatedRoleAssignments[role] = {
      voiceActor: conf.voiceActor,
      gender: actor.gender,
    };
    usedActors.add(conf.voiceActor);
  });

  const rolesInCards = [...new Set((parsedCards || []).filter((x) => x && x.type === "dialogue" && x.role && x.role !== "旁白").map((x) => x.role))];

  for (const role of rolesInCards) {
    if (validatedRoleAssignments[role]) continue;
    const roleGender = roleGenders[role] || "unknown";
    const actorName = pickNewActor(roleGender, actorPool, usedActors);
    if (!actorName) continue;
    validatedRoleAssignments[role] = {
      voiceActor: actorName,
      gender: actorPool[actorName].gender,
    };
    usedActors.add(actorName);
  }

  let narratorAudioId = null;
  if (casting.narratorAudioId) {
    const exists = narratorCandidates.some((x) => x.id === casting.narratorAudioId);
    if (exists) narratorAudioId = casting.narratorAudioId;
  }
  if (!narratorAudioId && narratorCandidates.length > 0) {
    narratorAudioId = narratorCandidates[0].id;
  }

  const finalCasting = {
    narratorAudioId,
    roleAssignments: validatedRoleAssignments,
  };

  saveProjectCasting(projectName, finalCasting);

  return {
    cards: attachAutoCastingToCards(parsedCards, finalCasting, actorPool),
    autoCasting: {
      enabled: true,
      narratorAudioId: finalCasting.narratorAudioId,
      roleAssignments: finalCasting.roleAssignments,
      roleGenders,
      availableVoiceActors: Object.keys(actorPool).length,
    },
  };
}

module.exports = {
  autoAssignReferenceAudios,
  normalizeGender,
};

