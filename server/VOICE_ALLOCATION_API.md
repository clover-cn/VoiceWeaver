# 生命周期感知自动配音接口文档

本文档对应当前服务端的“分级音色池 + 生命周期感知自动分配”功能，供前端音频库、阅读器和听书生成页面使用。

本文同时覆盖 RN-VoiceWeaver 当前客户端直接使用的配套接口。2026-09-14 根据客户端调用和服务端路由静态核对；不作为项目管理等全部服务端 API 的总表。第 10～14 节补充音频管理、角色绑定、任务状态和编辑重生成接口。

约定：除文件上传外，POST 请求使用 `Content-Type: application/json`；路径中的名称、查询参数应进行 URL 编码。章节索引及片段索引从 0 开始。接口响应没有统一的 `success` 包装，尤其听书检查、生成和轮询接口，应同时检查 HTTP 状态及各接口业务字段。错误通常返回 `{ "error": "错误说明" }`，部分错误还携带片段完成信息。

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

列表直接返回音频记录，还可能包含 `originalName`、`size`、`remark`、`sampleText`、`siliconUri` 等字段，不能假设每条记录都有这些字段。`sampleText` 是参考音频对应文本，当前客户端按缺省空字符串处理，使用第 10.4 节接口保存。

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

请求还支持可选布尔值 `skipCacheInvalidation`，默认 `false`。默认在设置或取消锁定后，清理从 `chapterIndex`（默认 0）开始的听书缓存。当前客户端编辑流程传 `true`，随后自行保存章节编辑并触发重生成，避免提前清空缓存。

设置成功的实际响应包含 `success`、`role`、`projectName`、`assignment`、`voiceActor` 和 `audio`（`id`、`name`、`url`、`voicePool`）。上面的对象是保存的角色分配，不是完整响应。取消成功返回 `success`、`role`、`projectName`、`assignment: null`、`clearedManualOverride: true`。缺少项目或角色返回 400，音频不存在返回 404，无法识别声线或选择旁白音频返回 400。

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

必填字段为 `projectName`、`chapterIndex`、`chapterText`；章节索引必须为非负整数，正文去除首尾空白后不能为空，否则返回 400。`chapterTitle` 默认空字符串，`prescanTexts` 默认空数组。

该接口异步生成，成功响应分为三种情况，均包含 `taskId`、`segments`、`failedIndexes`、`completedSegments`、`totalSegments`：

| 情况 | 附加字段 | 前端处理 |
| --- | --- | --- |
| 新建或恢复生成任务 | 无 | 使用 `taskId` 轮询第 12.3 节接口 |
| 同正文已有运行任务 | `inProgress: true` | 复用任务并继续轮询 |
| 同正文已有完整可播放缓存 | `alreadyDone: true`，`failedIndexes: []` | 直接使用返回片段 |

新任务响应示例：

```json
{"taskId":"task-id","segments":[],"failedIndexes":[],"completedSegments":0,"totalSegments":0}
```

服务端对首尾去空白后的正文计算 UTF-8 SHA-256。已有章节缓存正文哈希变化时，会取消当前及后续章节任务，并清理从当前章节开始的缓存。部分失败缓存不视为生成完成，会进入恢复生成流程。

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

## 10. 音频库管理

### 10.1 `GET /api/tts/provider`

无请求参数。返回当前 TTS 提供商：

```json
{"success":true,"provider":"siliconflow"}
```

`provider` 来自 `TTS_DEFAULT_PROVIDER`，未配置时为 `siliconflow`。当前客户端据此控制参考文本编辑等交互。

### 10.2 `POST /api/audio/upload`

使用 `multipart/form-data`，不要发送 JSON 文件内容。当前客户端通过原生桥接上传。

| 表单字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | 文件 | 是 | 参考音频文件，字段名必须为 `file` |
| `name` | string | 否 | 自定义音频名称；缺省使用原文件名去掉扩展名 |

成功响应示例：

```json
{
  "success": true,
  "message": "上传成功",
  "data": {
    "id": "audio-id",
    "name": "刻晴-平静-女",
    "fileName": "stored.wav",
    "originalName": "reference.wav",
    "size": 123456,
    "createTime": "2026-09-14T00:00:00.000Z",
    "url": "/uploads/reference_audios/stored.wav",
    "remark": "",
    "voicePool": "general"
  }
}
```

缺少文件返回 400，保存失败返回 500。上传成功后刷新音频列表；新上传音频初始为通用池。

### 10.3 `DELETE /api/audio/:id`

路径参数 `id` 为音频记录 ID，无请求体。

```json
{"success":true,"message":"删除成功"}
```

删除音频文件和记录，同时清理各项目全局角色绑定中引用该 ID 的情绪配置。若记录有 `siliconUri`，先删除云端克隆语音；云端删除失败时中止本地删除。

错误：记录不存在返回 404；缺少云端删除所需配置或本地删除失败返回 500；云端删除失败返回 502。

### 10.4 `POST /api/audio/:id/sample-text`

路径参数 `id` 为音频记录 ID。

```json
{"sampleText":"这段文字与参考音频内容一致。"}
```

`sampleText` 必须是字符串，可以为空字符串。仅更新参考文本，保留已有 `siliconUri`。

```json
{"success":true,"message":"参考文本更新成功"}
```

字段类型错误返回 400，记录不存在返回 404，保存失败返回 500。

## 11. 全局角色绑定与阅读生成设置

### 11.1 `GET /api/audio/global-roles`

必填查询参数：`projectName`。全局指同一项目内跨章节使用，不是所有项目共享。

```json
{
  "success": true,
  "roles": {
    "陈艺": {
      "neutral": {
        "id": "audio-id",
        "mode": 1,
        "emoWeight": 0.65,
        "name": "刻晴-平静-女",
        "url": "/uploads/reference_audios/stored.wav",
        "voicePool": "general"
      }
    }
  }
}
```

结构为 `roles[角色名][情绪]`，配置与对应音频记录字段合并后返回。没有有效音频记录的绑定会被跳过，但 `mode: 3` 的配置仍保留。缺少项目名返回 400，读取失败返回 500。

### 11.2 `POST /api/audio/global-roles`

`projectName`、`bindings` 必填，`bindings` 为角色到情绪配置的映射。

```json
{
  "projectName": "我的郁金香小姐",
  "bindings": {
    "陈艺": {"neutral":{"id":"audio-id","mode":1,"emoWeight":0.65}}
  }
}
```

实际行为是增量更新：未传入的角色和情绪保留；传入的情绪配置替换对应配置。`{"陈艺": null}` 删除整个角色绑定，`{"陈艺":{"neutral":null}}` 删除该情绪绑定，角色没有剩余情绪时自动删除。空对象不会清空已有绑定。无 `id` 且 `mode` 不为 3 的对象也会删除对应情绪配置。

```json
{"success":true,"message":"角色全局音频绑定更新成功"}
```

缺少项目名或绑定格式不正确返回 400，保存失败返回 500。此接口保存绑定，不直接触发章节重生成。

### 11.3 `GET /api/reader/generation-settings`

必填查询参数：`projectName`。

```json
{
  "success": true,
  "projectName": "我的郁金香小姐",
  "settings": {"missingEmotionPolicy":"fallback_neutral"}
}
```

`settings` 为项目阅读生成配置；当前客户端读取 `missingEmotionPolicy`，用于缺少角色对应情绪音频时的处理。缺少项目名返回 400，读取失败返回 500。

## 12. 听书配置、缓存和任务生命周期

### 12.1 `GET /api/listen-book/config`

无请求参数。

```json
{"success":true,"prefetchCount":2,"prescanCount":10}
```

`prefetchCount` 来自 `LISTEN_PREFETCH_COUNT`，默认 2；`prescanCount` 来自 `PRESCAN_CHAPTER_COUNT`，默认 10。两者均按非负整数读取，可配置为 0。

### 12.2 `POST /api/listen-book/check`

```json
{"projectName":"我的郁金香小姐","chapterIndex":1}
```

`projectName`、`chapterIndex` 必填；可选 `contentHash` 为章节正文 `trim()` 后按 UTF-8 计算的 SHA-256 十六进制字符串。非法章节索引或缺少必要参数返回 400。

完整缓存响应示例：

```json
{"exists":true,"segments":[],"failedIndexes":[],"completedSegments":3,"totalSegments":3}
```

上例为简洁起见省略实际片段内容；完整缓存的 `segments` 应包含对应可播放片段。

| 分支 | 响应特征 |
| --- | --- |
| 完整可播放缓存 | `exists: true`，包含片段和完成统计 |
| 正文哈希不一致 | `exists: false`、`stale: true`、`resumable: false`、`phase: null`；片段及失败索引为空，统计为 0 |
| 已有活动任务 | `exists: false`、`inProgress: true`、`taskId`、`phase`，包含当前片段及完成统计 |
| 无缓存或不完整缓存 | `exists: false`、`resumable`、`phase`、`error`，包含已有片段及完成统计 |

`resumable` 表示存在解析卡片或已有片段，客户端可再次调用 `generate` 恢复生成。检查接口发现哈希不一致时仅返回过期标记，不执行缓存删除。

### 12.3 `GET /api/listen-book/status/:taskId`

路径参数 `taskId` 来自生成或自动重生成响应，无请求体。

```json
{
  "taskId": "task-id",
  "phase": "tts",
  "progress": 65,
  "ttsProgress": {"current":1,"total":2},
  "segments": [],
  "failedIndexes": [],
  "completedSegments": 1,
  "totalSegments": 2,
  "error": null
}
```

示例省略实际片段内容。`segments` 中每项以 `index` 标识位置，包含 `type`、`role`、`emotion`、`text`、`audioUrl`、`generationError` 以及参考音频配置等字段。无可播放音频时 `audioUrl` 可以为 `null`。

`phase` 包括 `waiting`、`prescan`、`parse`、`assign`、`tts`、`running`、`done`、`error`、`cancelled`；缓存恢复响应还可能出现 `resuming`。`progress` 为进度百分比，`ttsProgress` 可以为 `null`。

`done` 只表示任务结束，不保证全部片段成功；应同时判断 `failedIndexes`、完成数量及片段 `audioUrl`。收到 `error` 或 `cancelled` 应结束相应等待。客户端可在任务结束前播放已生成片段。

服务重启后，若内存无任务但持久缓存可查到该任务，返回缓存状态，此分支可能不含 `taskId`。内存和缓存均不存在时返回 404。

### 12.4 `POST /api/listen-book/cancel`

```json
{"projectName":"我的郁金香小姐"}
```

必填 `projectName`，按项目取消尚未结束的任务。

```json
{"success":true,"cancelledTaskIds":["task-id"]}
```

没有可取消任务时数组为空。取消请求发出中止信号，由任务流程在检查点处理中止；成功响应不表示所有后台工作已同步退出。缺少项目名返回 400。

## 13. 章节编辑与重生成

### 13.1 `POST /api/listen-book/chapter-edits`

```json
{
  "projectName": "我的郁金香小姐",
  "chapterIndex": 1,
  "invalidatedSegmentIndexes": [0],
  "segments": [
    {
      "type": "dialogue",
      "role": "陈艺",
      "emotion": "neutral",
      "text": "修改后的对白。",
      "referenceAudio": {"id":"audio-id","mode":1,"emoWeight":0.65},
      "autoEmotionAudioMap": null,
      "autoAssignedVoiceActor": "刻晴",
      "manualAssigned": true
    }
  ]
}
```

`projectName`、`chapterIndex`、`segments` 必填。`segments` 是整章编辑后的完整有序数组，数组位置对应片段索引，不是仅提交修改的片段。`invalidatedSegmentIndexes` 可选，默认空数组。

保存整章编辑快照；已有章节缓存时同步更新解析卡片与片段。失效索引对应的旧预览音频被删除，`audioUrl` 和 `generationError` 清空；其他片段保留已有音频。此接口不执行 TTS，需随后调用重生成接口。

```json
{"success":true}
```

缺少必要参数或 `segments` 不是数组返回 400。

### 13.2 `POST /api/listen-book/regenerate-segment`

```json
{
  "projectName": "我的郁金香小姐",
  "chapterIndex": 1,
  "segmentIndex": 0,
  "chapterTitle": "商场",
  "chapterText": "完整章节正文"
}
```

必填 `projectName`、`chapterIndex`、`segmentIndex`；两个索引均须为非负整数。可选 `chapterTitle`、`chapterText`、`contentHash`，默认空字符串。提供正文时使用正文计算的哈希，优先于传入的 `contentHash`。

有可复用解析缓存时使用缓存；没有解析缓存或正文哈希变化时，需要 `chapterText` 重建解析上下文。当前客户端会携带章节正文。此接口等待单段 TTS 完成后返回，不返回轮询任务 ID。

成功返回 `success: true`、`segment`（目标片段）、`segments`（整章片段）、`completedSegments`、`totalSegments`、`failedIndexes`。成功后更新章节缓存；新旧音频 URL 不同时删除旧预览文件。

| HTTP 状态 | 含义 |
| --- | --- |
| 400 | 缺少必要参数或索引非法 |
| 404 | 解析结果中没有目标片段 |
| 409 | 无可复用解析缓存，且未提供正文 |
| 422 | 重建解析未得到可生成的片段 |
| 500 | 解析或 TTS 等处理失败 |

重建失败或 TTS 失败响应可能附带 `segments`、`failedIndexes`、`completedSegments`、`totalSegments`。单段 TTS 失败时目标片段 `audioUrl` 被清空、`generationError` 记录错误，客户端应更新展示状态。

### 13.3 `POST /api/listen-book/auto-regenerate-after-edit`

```json
{
  "projectName": "我的郁金香小姐",
  "currentChapterIndex": 1,
  "invalidatedSegmentIndexes": [0],
  "futureRoleUpdate": {
    "role": "陈艺",
    "audioId": "audio-id",
    "emotionMap": {"neutral":{"id":"audio-id","mode":1,"emoWeight":0.65}},
    "voiceActor": "刻晴"
  }
}
```

必填 `projectName`、`currentChapterIndex`（非负整数）。`invalidatedSegmentIndexes` 默认空数组；`futureRoleUpdate` 默认 `null`，用于将角色声线更新应用于后续已缓存章节。

必须先保存章节编辑。服务端要求当前章节已有非空解析卡片，否则返回 409；不会在此接口根据正文重建解析。

服务端先取消当前及后续章节已有任务。传入有效 `futureRoleUpdate.role` 时，更新后续已有缓存章节中的对应角色，并收集需要重生成的片段；不会凭空创建未缓存章节。

接口立即返回：

```json
{"success":true,"taskId":"task-id","queuedFutureChapters":[2,3]}
```

随后后台先重生成当前章节指定片段，再处理后续受影响章节。客户端使用第 12.3 节接口轮询。任务结果中的片段和完成统计对应当前章节；后续章节失败可能仅记录服务端日志，不能用当前任务 `done` 推断所有后续章节均成功。

缺少必要参数或章节索引非法返回 400；无解析卡片返回 409；任务建立失败返回 500。响应返回后发生的后台错误通过任务状态反馈。

## 14. 当前客户端调用流程与覆盖范围

正常听书：获取 `config` → `check` 检查缓存 → 完整缓存直接播放；活动任务继续轮询；其余情况调用 `generate` → 轮询 `status/:taskId`。离开或切换项目时按需要调用 `cancel`。

编辑角色音频时：按需要调用 `role-audio-override`（`skipCacheInvalidation: true`）及 `global-roles` 更新绑定 → `chapter-edits` 保存整章编辑及失效索引 → `auto-regenerate-after-edit` → 轮询任务。单段重试使用 `regenerate-segment`。

服务端还存在当前客户端未直接调用的项目管理、单条 TTS、音频合并、备注修改、按任务取消、主动清理缓存，以及部分配置读取/写入接口；它们不属于本次按 RN 客户端补齐的范围。音频播放使用响应中的资源 URL。
