# VoiceWeaver (AI 多角色有声小说自动配音系统)

## 简介
VoiceWeaver 是一个基于大语言模型（LLM）和语音合成技术（TTS）的自动化多角色有声小说配音系统。其核心设计理念为**“大模型负责语义理解（NLU），后端负责状态管理与音频组装，前端负责人工校验”**。

## 系统架构

本系统采用前后端分离架构：

*   **前端交互层 (Vue3 + Tailwind CSS + Element Plus)：**
    *   提供文本输入界面。
    *   渲染 LLM 解析后的“角色-台词-情绪”卡片。
    *   提供手动下拉修正角色、修改音色及情绪标签的交互功能。
    *   触发音频生成指令。
*   **后端逻辑层 (Node.js + Express)：**
    *   隐藏 API 密钥并调用 LLM 进行文本结构化。
    *   维护全局角色状态字典 (`characters.json`)。
    *   将情绪标签映射为具体引擎的配置。
    *   并发请求 TTS 接口。
    *   管理本地文件 I/O。
*   **AI 与音视频服务 (基建层)：**
    *   **文本解析：** 具备强大长文本理解和指令遵循能力的大语言模型（如 Gemini、Claude 3.5 Sonnet、DeepSeek 等）。
    *   **语音合成 (TTS)：** 支持情绪标签的云服务（硅基流动的 IndexTTS2 或本地搭建的 IndexTTS2）。
    *   **媒体处理：** FFmpeg (通过 Node.js 的 `fluent-ffmpeg` 库调用)，负责将生成的短音频片段无缝拼接。

## 核心数据流转流程

1.  **输入与拆分：** 前端将长篇小说按章节发送给 Node.js 后端。
2.  **LLM 结构化：** 后端组装 Prompt 发送给大模型，提取 `type` (旁白/对话)、`role` (标准角色名)、`text` (处理后的文本) 和 `emotion` (情绪状态)。
3.  **映射与校对：** 后端查询本地 `characters.json` 匹配对应音色并返回前端。用户在界面进行最终确认和人工微调。
4.  **TTS 请求：** 确认无误后，后端将数据转换为目标 TTS 引擎格式，并发下载生成的音频片段。
5.  **拼接与输出：** 后端调用 FFmpeg 将所有音频片段合并，返回最终的长音频下载链接。

## 关键工程解决方案

*   **长篇角色记忆与音色漂移：** 引入单一数据源，利用 Node.js 维护持久化的 `characters.json` 字典。在 LLM 提取时强制映射标准名称。
*   **情绪标签归一化：** 建立情绪降维映射字典，将自然语言情绪映射为目标 TTS 引擎支持的枚举值。
*   **听觉平滑 (Audio Smoothing)：** 在 LLM 提取阶段前置清洗数据，根据语境在旁白末尾自动补全发音引导词，解决视觉标点转听觉时的突兀感。

## 试听音频
[🎵 点击试听音频](https://raw.githubusercontent.com/clover-cn/VoiceWeaver/main/demo/audio.mp3)

## 快速开始

### 前端配置
```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm run serve

# 构建生产版本
pnpm run build
```

### 后端配置

#### 本地运行

```bash
cd server
npm install
cp .env.example .env
# 编辑 .env，填入真实 LLM / TTS 配置
npm start
```

后端默认监听 `http://localhost:3000`，健康检查地址：

```bash
curl http://localhost:3000/api/health
```

#### Docker 运行

`docker-compose.yml` 位于 `server` 目录，服务器只需要部署整个 `server` 目录即可。

```bash
cd server
cp .env.example .env
# 编辑 .env，填入真实 LLM / TTS 配置
docker compose up --build
```

Docker 服务默认映射到 `http://localhost:3000`，运行时数据直接挂载到 `server` 目录内，方便复用和备份已有音频数据：

- `./data:/app/data`：保存项目数据、音频记录、草稿、角色配置、听书缓存和输出音频。
- `./uploads:/app/uploads`：保存上传的参考音频。

如果你把已有的 `server/data/audio_records.json`、`server/data/projects` 和 `server/uploads/reference_audios` 一起上传到服务器，容器启动后会直接复用这些数据，不需要重新上传音频。

停止服务但保留数据：

```bash
docker compose down
```

### 小米 MimoTTS 配置

如需使用小米 MimoTTS 声音克隆，将 `server/.env` 中的 `TTS_DEFAULT_PROVIDER` 设置为 `mimoTTS`，并配置 `MIMO_API_KEY`。语音风格通过 `MIMO_TTS_STYLE_PROMPT` 配置，例如“保持样本声线，减少夸张表演，语气清楚、平稳、贴近真实说话。”；该自然语言指令只对 MimoTTS 生效。

MimoTTS 当前按非流式接口调用，后端会请求 `pcm16` 并封装为 WAV 临时音频，以兼容现有试听和合并流程。

### indexTTs2中转

将 `api_server.py` 文件放入 IndexTTS2 根目录。

```bash
# 标准启动（兼容性强、高稳定性启动模式）
uv run api_server.py

# 开启半精度推理启动（推荐有支持 FP16 计算能力的显卡环境使用，能显著提速并节省约一半的显存）
uv run api_server.py --fp16
```

如果后端运行在 Docker 容器中，`TTS_ENDPOINT=http://127.0.0.1:8000/...` 会指向后端容器自身，不会指向宿主机。

宿主机运行 IndexTTS2 时，请配置：

```dotenv
TTS_DEFAULT_PROVIDER=indextts2
TTS_ENDPOINT=http://host.docker.internal:8000/api/tts/upload
```

如果 IndexTTS2 也在同一个 Docker Compose 网络中，请使用服务名：

```dotenv
TTS_DEFAULT_PROVIDER=indextts2
TTS_ENDPOINT=http://indextts2:8000/api/tts/upload
```

