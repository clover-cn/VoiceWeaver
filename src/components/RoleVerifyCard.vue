<template>
  <div class="h-full flex flex-col bg-gray-100">
    <!-- 头控件 -->
    <div class="p-4 bg-white border-b border-gray-200 flex justify-between items-center shadow-sm shrink-0">
      <h2 class="text-lg font-bold text-gray-800 flex items-center gap-2">
        <el-icon><MagicStick /></el-icon> AI 解析与调度台
      </h2>
      <div class="space-x-3">
        <el-button @click="openAudioLibrary" plain type="info"
          ><el-icon class="mr-1"><Service /></el-icon>参考音频库</el-button
        >
        <el-button @click="openRoleSetup" plain type="warning" :disabled="dialogueCards.length === 0"
          ><el-icon class="mr-1"><Setting /></el-icon>统一音频配置</el-button
        >
        <el-button plain @click="clearList" :disabled="dialogueCards.length === 0">清空列表</el-button>
        <el-button type="primary" :loading="isGeneratingAll" @click="handleGenerateAll" :disabled="dialogueCards.length === 0 || isGeneratingAll || isMergingAll">
          <el-icon><Microphone class="mr-1" /></el-icon> 一键生成音频
        </el-button>
        <el-button type="success" :loading="isMergingAll" @click="handleMergeAll" :disabled="!canMergeAll || isGeneratingAll || isMergingAll">
          <el-icon><VideoPlay class="mr-1" /></el-icon> 音频合并
        </el-button>
      </div>
    </div>

    <!-- 进度条区域 -->
    <div v-if="isGeneratingAll" class="px-6 py-4 bg-blue-50 border-b border-blue-100 flex flex-col gap-2 shrink-0 transition-all">
      <div class="flex justify-between items-center text-sm text-blue-800 font-medium">
        <span>正在合成音频... ({{ generateCurrentIndex }} / {{ generateTotal }})</span>
        <span>{{ generateProgress }}%</span>
      </div>
      <el-progress :percentage="generateProgress" :show-text="false" :stroke-width="10" status="success"></el-progress>
      <div class="text-xs text-blue-600 truncate">当前片段: {{ currentGeneratingText }}</div>
    </div>

    <!-- 卡片列表 -->
    <div v-if="dialogueCards.length > 0" class="flex-1 p-6 overflow-y-auto space-y-4 pb-24 scroll-smooth">
      <div
        v-for="(card, index) in dialogueCards"
        :key="index"
        class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow duration-200 relative group overflow-hidden"
      >
        <!-- 侧边颜色条指示 (对话/旁白) -->
        <div class="absolute left-0 top-0 bottom-0 w-1.5" :class="card.type === 'narration' ? 'bg-gray-300' : 'bg-blue-500'"></div>

        <div class="flex items-start pl-3 gap-4">
          <!-- 左侧：角色卡片 -->
          <div class="w-32 shrink-0 flex flex-col items-center p-2 rounded-lg relative" :class="card.type === 'narration' ? 'bg-gray-50' : 'bg-blue-50'">
            <div class="font-bold text-gray-700 text-sm mb-1">🎭 角色纠错</div>
            <el-input v-model="card.role" size="small" class="mb-2" :readonly="card.type === 'narration'" @change="handleRoleChange(card)"></el-input>

            <div class="font-bold text-gray-700 text-sm mb-1 mt-1">🎙️ 情感选择</div>
            <el-select v-model="card.emotion" size="small" placeholder="情绪选择" class="w-full" @change="handleEmotionChange(card)">
              <el-option label="高兴" value="happy"></el-option>
              <el-option label="愤怒" value="angry"></el-option>
              <el-option label="悲伤" value="sad"></el-option>
              <el-option label="害怕" value="fearful"></el-option>
              <el-option label="厌恶" value="disgusted"></el-option>
              <el-option label="忧郁" value="melancholy"></el-option>
              <el-option label="惊讶" value="surprised"></el-option>
              <el-option label="平静" value="neutral"></el-option>
            </el-select>

            <div
              v-if="hasReferenceAudio(card)"
              class="mt-2 text-[10px] text-green-600 font-bold bg-green-100 px-1 py-0.5 rounded w-full text-center flex items-center justify-center gap-1 shadow-sm border border-green-200"
            >
              <el-icon><Check /></el-icon>{{ ttsProvider === 'indextts2' && card.referenceAudio && typeof card.referenceAudio === "object" && card.referenceAudio.mode === 3 ? "带向量控制" : "带参考音" }}
            </div>
          </div>

          <!-- 右侧：文本内容 -->
          <div class="flex-1 pt-1 flex flex-col">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-semibold px-2 py-1 rounded-full text-white" :class="card.type === 'narration' ? 'bg-gray-400' : 'bg-blue-400'">
                {{ card.type === "narration" ? "旁白引导" : "台词片段" }}
              </span>
              <div class="flex items-center gap-2">
                <!-- 试听与单次生成控制 -->
                <audio v-if="card.audioUrl" :src="'http://localhost:3000' + card.audioUrl" controls class="h-8 max-w-[200px]" preload="none"></audio>

                <el-button size="small" type="primary" plain :loading="card.isGenerating" @click="handleGenerateSingle(index)">
                  {{ card.audioUrl ? "重新生成" : "单独生成" }}
                </el-button>

                <el-button link type="danger" size="small" @click="removeCard(index)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </div>

            <el-input v-model="card.text" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" class="text-gray-800 font-medium tracking-wide mt-2 w-full custom-text" resize="none" />
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="flex-1 flex flex-col items-center justify-center text-gray-400 mt-20">
      <el-icon :size="64" class="mb-4 text-gray-200"><Box /></el-icon>
      <p>暂无数据，请在左侧输入小说文本并点击 AI 解析</p>
    </div>

    <!-- 下载横幅 -->
    <div
      v-if="downloadReadyUrl"
      class="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-10 w-[90%] bg-green-500 rounded-lg shadow-xl p-4 flex items-center justify-between text-white transition-all"
    >
      <div class="flex items-center gap-3">
        <el-icon :size="24"><CircleCheckFilled /></el-icon>
        <div>
          <div class="font-bold">配音生成完毕！</div>
          <div class="text-xs text-green-100">所有片段已合成一个连续音频</div>
        </div>
      </div>
      <!-- 这里真实环境中应配合 a 标签进行下载，并提供 H5 试听 -->
      <a :href="'http://localhost:3000' + downloadReadyUrl" target="_blank">
        <el-button color="#fff" class="text-green-600 font-bold" round> 立即下载收听 </el-button>
      </a>
    </div>

    <!-- 弹窗组件挂载区 -->
    <AudioLibraryDialog ref="audioLibraryDialogRef" />
    <RoleAudioSetupDialog ref="roleAudioSetupDialogRef" @saved="handleAudioSetupSaved" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from "vue";
import axios from "axios";
import { ElMessage, ElMessageBox } from "element-plus";
import { MagicStick, VideoPlay, Microphone, Delete, Box, CircleCheckFilled, Check, Service, Setting } from "@element-plus/icons-vue";
import AudioLibraryDialog from "./AudioLibraryDialog.vue";
import RoleAudioSetupDialog from "./RoleAudioSetupDialog.vue";

const props = defineProps({
  projectName: {
    type: String,
    default: "",
  },
  initialCards: {
    type: Array,
    default: () => [],
  },
  globalCharacters: {
    type: Object,
    default: () => ({}),
  },
});

const dialogueCards = ref([]);
const isGeneratingAll = ref(false);
const isMergingAll = ref(false);
const downloadReadyUrl = ref(null);

const generateProgress = ref(0);
const generateCurrentIndex = ref(0);
const generateTotal = ref(0);
const currentGeneratingText = ref("");

const audioLibraryDialogRef = ref(null);
const roleAudioSetupDialogRef = ref(null);

const globalAudioBindings = ref({});
const ttsProvider = ref("siliconflow");

const fetchProvider = async () => {
  try {
    const res = await axios.get("http://localhost:3000/api/tts/provider");
    if (res.data.success) {
      ttsProvider.value = res.data.provider;
    }
  } catch (error) {
    console.warn("获取 TTS 提供商失败，默认使用 siliconflow 模式");
  }
};

const fetchGlobalBindings = async () => {
  try {
    const globalRes = await axios.get("http://localhost:3000/api/audio/global-roles");
    if (globalRes.data.success) {
      globalAudioBindings.value = globalRes.data.roles;
      return globalRes.data.roles;
    }
  } catch (e) {
    console.error("尝试拉取全局参考音频失败", e);
  }
  return null;
};

onMounted(() => {
  fetchProvider();
  fetchGlobalBindings();
});

const handleEmotionChange = (card) => {
  if (card.role && globalAudioBindings.value[card.role]) {
    const roleData = globalAudioBindings.value[card.role];
    const currentEmotion = card.emotion || "neutral";
    if (roleData[currentEmotion]) {
      card.referenceAudio = roleData[currentEmotion];
    } else {
      delete card.referenceAudio;
    }
  } else {
    delete card.referenceAudio;
  }
};

const handleRoleChange = (card) => {
  handleEmotionChange(card);
};

const hasReferenceAudio = (card) => {
  if (card.referenceAudio) {
    if (typeof card.referenceAudio === "string") return true;
    if (card.referenceAudio.id) return true;
    if (ttsProvider.value === "indextts2" && card.referenceAudio.mode === 3) return true;
  }
  
  // 如果当前情感没有配置或没有 id，检查是否有 neutral 的 id 作为 fallback
  if (card.role && globalAudioBindings.value[card.role]) {
    const roleData = globalAudioBindings.value[card.role];
    if (roleData["neutral"] && (typeof roleData["neutral"] === "string" || roleData["neutral"].id)) {
      return true;
    }
  }
  return false;
};

const canMergeAll = computed(() => {
  return dialogueCards.value.length > 0 && dialogueCards.value.every((c) => c.fileName);
});

const openAudioLibrary = () => {
  if (audioLibraryDialogRef.value) audioLibraryDialogRef.value.openDialog();
};

const openRoleSetup = () => {
  // 提取唯一的角色（包含旁白）
  const roles = [...new Set(dialogueCards.value.filter((c) => c.role).map((c) => c.role))];
  if (roleAudioSetupDialogRef.value) {
    roleAudioSetupDialogRef.value.openDialog(roles);
  }
};

const handleAudioSetupSaved = async (bindings) => {
  // bindings 格式: { "张三": { "happy": "audioId1", "neutral": null }, ... }
  dialogueCards.value.forEach((card) => {
    if (card.role && bindings.hasOwnProperty(card.role)) {
      const emotionMap = bindings[card.role];
      const currentEmotion = card.emotion || "neutral";
      const newAudioConfig = emotionMap ? emotionMap[currentEmotion] : null;
      if (newAudioConfig) {
        card.referenceAudio = newAudioConfig;
      } else {
        delete card.referenceAudio;
      }
    }
  });

  await fetchGlobalBindings();
};

// 注入外部数据
watch(
  () => props.initialCards,
  async (newVal) => {
    const newCardsStr = JSON.stringify(newVal || []);
    const oldCardsStr = JSON.stringify(dialogueCards.value || []);

    if (newCardsStr !== oldCardsStr) {
      let parsed = JSON.parse(newCardsStr);

      // -- 自动注入全局参考音频逻辑（匹配 角色名 + 当前情感 维度）--
      if (parsed.length > 0) {
        const bindingsMap = await fetchGlobalBindings();
        if (bindingsMap) {
          parsed.forEach((card) => {
            if (card.role) {
              const roleData = bindingsMap[card.role];
              const currentEmotion = card.emotion || "neutral";
              if (roleData && roleData[currentEmotion]) {
                card.referenceAudio = roleData[currentEmotion];
              } else {
                delete card.referenceAudio;
              }
            }
          });
        }
      }

      dialogueCards.value = parsed;
      downloadReadyUrl.value = null;
    }
  },
  { deep: true },
);

const emit = defineEmits(["onCardsChanged"]);

// 当内部卡片数据有变动（如角色修改、情绪修改、删卡片）抛给上级保存
watch(
  dialogueCards,
  (newCards) => {
    emit("onCardsChanged", newCards);
  },
  { deep: true },
);

const removeCard = (index) => {
  dialogueCards.value.splice(index, 1);
};

const clearList = () => {
  dialogueCards.value = [];
  downloadReadyUrl.value = null;
};

const handleGenerateSingle = async (index, isBatch = false) => {
  const card = dialogueCards.value[index];
  if (!card) return;

  card.isGenerating = true;
  downloadReadyUrl.value = null;

  try {
    const res = await axios.post("http://localhost:3000/api/tts/generate-single", {
      dialogue: card,
      projectName: props.projectName,
    });
    if (res.data.success) {
      card.fileName = res.data.fileName;
      // 附加时间戳避免游览器缓存相同路径的临时音频
      card.audioUrl = res.data.audioUrl + "?t=" + Date.now();
      if (!isBatch) {
        ElMessage.success(`第 ${index + 1} 段音频生成成功`);
      }
    }
  } catch (error) {
    if (!isBatch) {
      ElMessage.error(error.response?.data?.error || `第 ${index + 1} 段音频生成失败`);
    } else {
      throw error;
    }
  } finally {
    card.isGenerating = false;
  }
};

const handleGenerateAll = async () => {
  if (dialogueCards.value.length === 0) return;

  const cardsToGenerate = dialogueCards.value.filter((c) => !c.fileName);
  if (cardsToGenerate.length === 0) {
    ElMessage.info("所有片段均已生成音频。");
    return;
  }

  isGeneratingAll.value = true;
  downloadReadyUrl.value = null;
  generateTotal.value = cardsToGenerate.length;
  generateCurrentIndex.value = 0;
  generateProgress.value = 0;

  try {
    // 采用串行执行，避免瞬间高并发请求压垮下层 TTS，同时提供清晰进度感
    for (let i = 0; i < dialogueCards.value.length; i++) {
      const card = dialogueCards.value[i];
      if (!card.fileName) {
        generateCurrentIndex.value++;
        currentGeneratingText.value = card.text;

        await handleGenerateSingle(i, true);

        generateProgress.value = Math.floor((generateCurrentIndex.value / generateTotal.value) * 100);
      }
    }

    ElMessageBox.alert("所有未处理片段均已成功生成！您可以开始试听或进行音频合并。", "生成完成", {
      confirmButtonText: "确定",
      type: "success",
    });
  } catch (error) {
    ElMessage.error("批量请求中断或部分发生异常。");
  } finally {
    isGeneratingAll.value = false;
    setTimeout(() => {
      generateProgress.value = 0;
      generateCurrentIndex.value = 0;
      generateTotal.value = 0;
      currentGeneratingText.value = "";
    }, 1000);
  }
};

const handleMergeAll = async () => {
  if (!canMergeAll.value) return;

  let pauseDuration = 0;
  try {
    const { value } = await ElMessageBox.prompt("请输入每段语音结尾的停顿时间（秒），默认0秒，最长5秒", "设置停顿时间", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      inputValue: "0",
      inputPattern: /^([0-4](\.\d+)?|5(\.0+)?)$/,
      inputErrorMessage: "请输入0到5之间的数字",
    });
    pauseDuration = parseFloat(value) || 0;
    if (pauseDuration < 0 || pauseDuration > 5) {
      ElMessage.error("停顿时间必须在0到5秒之间");
      return;
    }
  } catch (e) {
    // 用户取消输入
    return;
  }

  isMergingAll.value = true;
  downloadReadyUrl.value = null;
  ElMessage.info("正在将生成的音频合成为最终文件，请稍候...");

  try {
    const fileArg = dialogueCards.value.map((c) => c.fileName);
    const res = await axios.post("http://localhost:3000/api/tts/merge", {
      fileNames: fileArg,
      projectName: props.projectName,
      pauseDuration: pauseDuration,
    });

    if (res.data.success) {
      ElMessage.success("整本配音组装成功！");
      downloadReadyUrl.value = res.data.downloadUrl;
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || "合并请求异常");
  } finally {
    isMergingAll.value = false;
  }
};
</script>

<style scoped>
:deep(.custom-text .el-textarea__inner) {
  background-color: transparent !important;
  border: 1px solid transparent;
  box-shadow: none !important;
  transition: all 0.3s ease;
}
:deep(.custom-text .el-textarea__inner:hover),
:deep(.custom-text .el-textarea__inner:focus) {
  background-color: #f9fafb !important;
  border-color: #e5e7eb;
}
/* 隐藏浏览器原生滚动条美化 */
.overflow-y-auto::-webkit-scrollbar {
  width: 6px;
}
.overflow-y-auto::-webkit-scrollbar-track {
  background: transparent;
}
.overflow-y-auto::-webkit-scrollbar-thumb {
  background-color: #cbd5e1;
  border-radius: 20px;
}
</style>
