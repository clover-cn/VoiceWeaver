# 生命周期感知自动配音接口文档

本文档对应当前服务端的“分级音色池 + 生命周期感知自动分配”功能，供前端音频库、阅读器和听书生成页面使用。

## 1. 核心概念

服务端仍然只维护一个物理音频库：

```text
data/audio_records.json
uploads/reference_audios/
```

每套声线可以属于以下音频池：

| voicePool | 说明 |
| --- | --- |
| `general` | 默认通用池，未标记音频都属于此池 |
| `bystander` | 路人池，临时角色优先使用 |
| `protected` | 保护池，核心角色优先使用；临时角色不会主动使用 |

音频池按同一 `voiceActor` 的整套情绪音频生效，不需要用户逐条设置。

角色分配类型：

| allocationType | 说明 |
| --- | --- |
| `core` | 核心角色或手动锁定角色，长期保持声线 |
| `supporting` | 支持角色，在滚动预扫描范围内保持稳定 |
| `temporary` | 临时角色，后续不出现时允许回收声线 |

## 2. 获取音频库

### `GET /api/audio/list`

响应：

```json
{
  "success": true,
  "list": [
    {
      "id": "audio-id",
      "name": "刻晴-平静-女",
      "fileName": "file.wav",
      "url": "/uploads/reference_audios/file.wav",
      "voicePool": "bystander",
      "createTime": "2026-08-08T00:00:00.000Z"
    }
  ]
}
```

历史记录没有 `voicePool` 时，服务端按 `general` 返回。

## 3. 按声线修改音频池

服务端通过音频名称解析声线：名称第一个 `-` 前的部分为 `voiceActor`。例如：

```text
刻晴-生气-女
刻晴-平静-女
```

以上音频都属于 `刻晴`，前端按声线聚合显示，一次修改会同步该声线的全部情绪音频。

### `POST /api/audio/voice-actor/:voiceActor/pool`

请求：

```json
{
  "voicePool": "bystander"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `voicePool` | string | 否 | `general`、`bystander` 或 `protected`，默认 `general` |

取消路人标记：

```json
{
  "voicePool": "general"
}
```

成功响应：

```json
{
  "success": true,
    "data": {
    "voiceActor": "刻晴",
    "voicePool": "bystander",
    "affectedAudioIds": ["id-1", "id-2", "id-3"],
    "affectedCount": 3
  }
}
```

建议前端提供三个按钮：

```text
标记为路人池 → voicePool=bystander
标记为保护池 → voicePool=protected
取消标记     → voicePool=general
```

不需要用户给所有音频分类。默认保持 `general` 即可。

迁移说明：旧的 `PATCH /api/audio/:id/pool` 和 `voiceTags` 字段不再使用。历史 `audio_records.json` 中的旧字段会被忽略，并在下一次音频记录写入时清理。

## 4. 手动锁定角色声线

### `POST /api/reader/role-audio-override`

请求：

```json
{
  "projectName": "我的郁金香小姐",
  "role": "陈艺",
  "audioId": "audio-id",
  "chapterIndex": 0
}
```

成功后，该角色保存为：

```json
{
  "voiceActor": "刻晴",
  "gender": "female",
  "manualOverride": true
}
```

`manualOverride=true` 的角色不会被生命周期回收，也不会被自动改声线。

取消手动锁定：

```json
{
  "projectName": "我的郁金香小姐",
  "role": "陈艺",
  "audioId": null,
  "chapterIndex": 0
}
```

## 5. 章节角色预扫描

### `POST /api/llm/prescan-characters`

推荐请求格式：

```json
{
  "projectName": "我的郁金香小姐",
  "chapters": [
    {
      "chapterIndex": 1,
      "chapterTitle": "商场",
      "text": "来到商场后，导购说道……"
    },
    {
      "chapterIndex": 2,
      "chapterTitle": "回家",
      "text": "章节正文……"
    }
  ],
  "combinedText": "可选，兼容旧调用方"
}
```

`chapters` 是推荐字段。旧前端只传 `combinedText` 仍可调用，但无法获得准确的章节生命周期统计。

成功响应：

```json
{
  "success": true,
  "data": {
    "导购": {
      "name": "导购",
      "gender": "female",
      "aliases": [],
      "description": "商场柜台工作人员",
      "voice": "default_voice"
    }
  },
  "roleActivity": [
    {
      "standardName": "导购",
      "gender": "female",
      "importance": "temporary",
      "chapterStats": [
        {
          "chapterIndex": 1,
          "dialogueCount": 1,
          "mentionCount": 1
        }
      ]
    }
  ],
  "lifecycle": {
    "roleStats": {},
    "observation": {
      "observedChapterIndexes": [1, 2],
      "observedThroughChapter": 2,
      "complete": true
    }
  }
}
```

前端如果能提供完整的滚动窗口，应按章节顺序传入当前章节和后续章节。服务端只有在预扫描窗口完整时，才会释放长期不出现的临时角色声线。

## 6. LLM 解析和自动分配

### `POST /api/llm/parse`

请求：

```json
{
  "projectName": "我的郁金香小姐",
  "chapterIndex": 1,
  "text": "章节正文……"
}
```

`chapterIndex` 可选：

- 听书流程必须传入，用于生命周期分配。
- 普通单章解析可以不传，此时服务端不会主动释放历史角色。

解析结果中的卡片增加字段：

```json
{
  "type": "dialogue",
  "role": "导购",
  "emotion": "neutral",
  "gender": "female",
  "text": "这款胸针是今年的特别款。",
  "referenceAudio": {
    "id": "audio-id",
    "mode": 1,
    "emoWeight": 0.65
  },
  "autoAssignedVoiceActor": "刻晴",
  "autoEmotionAudioMap": {},
  "voiceAllocationType": "temporary",
  "voicePool": "bystander",
  "sharedVoice": false
}
```

`autoCasting` 关键字段：

```json
{
  "enabled": true,
  "policyVersion": "lifecycle-v1",
  "roleClassifications": {
    "导购": "temporary",
    "陈艺": "core"
  },
  "releasedActors": ["刻晴"],
  "sharedActors": [
    {
      "voiceActor": "甘雨",
      "roles": ["导购", "服务员"],
      "voicePool": "bystander"
    }
  ],
  "voiceChanges": [
    {
      "role": "导购",
      "from": "刻晴",
      "to": "甘雨"
    }
  ],
  "lookahead": {
    "chapterIndex": 1,
    "chapters": 10,
    "complete": true,
    "observedThroughChapter": 10
  },
  "warnings": []
}
```

## 7. 听书生成接口变化

### `POST /api/listen-book/generate`

原有请求仍兼容：

```json
{
  "projectName": "我的郁金香小姐",
  "chapterIndex": 1,
  "chapterTitle": "商场",
  "chapterText": "当前章节正文",
  "prescanTexts": [
    {
      "chapterIndex": 1,
      "chapterTitle": "商场",
      "text": "当前章节正文"
    },
    {
      "chapterIndex": 2,
      "chapterTitle": "回家",
      "text": "下一章节正文"
    }
  ]
}
```

听书流程会自动：

1. 调用预扫描并保存角色生命周期。
2. 调用 `/api/llm/parse`，携带 `chapterIndex`。
3. 按音频池和角色生命周期分配声线。
4. 将分配结果写入章节缓存。

已经生成的章节不会因为后续声线回收而自动改变。

## 8. 配置项

```env
PRESCAN_CHAPTER_COUNT=10
VOICE_ALLOCATION_LOOKAHEAD_CHAPTERS=10
VOICE_ALLOCATION_CORE_MIN_CHAPTERS=3
VOICE_ALLOCATION_CORE_MIN_DIALOGUE_COUNT=8
VOICE_ALLOCATION_TEMPORARY_MAX_CHAPTERS=1
VOICE_ALLOCATION_TEMPORARY_MAX_DIALOGUE_COUNT=3
```

如果没有设置 `VOICE_ALLOCATION_LOOKAHEAD_CHAPTERS`，系统使用 `PRESCAN_CHAPTER_COUNT`。

## 9. 前端推荐交互

音频库页面：

```text
声线 | 情绪音频数 | 音频池 | 操作
刻晴 | 4 条       | 路人池 | 修改
```

角色配置页面：

```text
角色 | 类型 | 当前声线 | 状态
陈艺 | 核心 | 夜兰 | 已锁定
导购 | 临时 | 刻晴 | 可回收
```

章节生成完成后，如果 `autoCasting.warnings` 非空，建议显示非阻断式警告；如果 `sharedActors` 有数据，显示“音频池不足，存在共享声线”。
