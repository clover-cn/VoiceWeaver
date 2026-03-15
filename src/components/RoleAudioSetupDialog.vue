<template>
  <el-dialog v-model="dialogVisible" title="全局角色参考音频配置" width="72%" destroy-on-close>
    <div class="flex flex-col" style="max-height: 68vh">
      <!-- 提示说明 -->
      <div class="mb-4 text-sm text-gray-500 bg-blue-50 p-3 rounded border border-blue-100 flex items-start gap-2 shrink-0">
        <el-icon class="text-blue-500 mt-0.5 shrink-0"><InfoFilled /></el-icon>
        <div>
          <p>提取了当前小说列表内出现的所有角色。</p>
          <p>为每个角色的不同情感维度绑定参考音频，生成时将自动依据情感选择对应的参考音频。</p>
        </div>
      </div>

      <!-- 角色列表 -->
      <div class="flex-1 overflow-y-auto space-y-3 pr-1">
        <div v-if="loading" class="py-10 text-center text-gray-400">加载数据中...</div>
        <div v-else-if="uniqueRoles.length === 0" class="py-10 text-center text-gray-400">当前没有提取到任何角色</div>

        <!-- 每个角色一张卡片 -->
        <div v-for="role in uniqueRoles" :key="role" class="border border-gray-200 rounded-xl overflow-hidden">
          <!-- 角色标题栏 -->
          <div class="bg-gray-50 px-4 py-3 border-b border-gray-200 flex flex-col gap-1.5 justify-center">
            <div class="flex items-center justify-between">
              <span class="text-base font-bold text-gray-800">🎭 {{ role }}</span>
              <template v-if="ttsProvider === 'indextts2'">
                <el-radio-group v-model="roleModes[role]" size="small" @change="handleRoleModeChange(role)">
                  <el-radio :value="1">同音色模式</el-radio>
                  <el-radio :value="2">附加情感模式</el-radio>
                  <el-radio :value="3">纯向量控制</el-radio>
                </el-radio-group>
              </template>
            </div>
            <span class="text-xs text-gray-400 font-medium" v-if="ttsProvider !== 'indextts2' || roleModes[role] === 1">· 点击下方选择框为该角色的各情感绑定独立生成的参考音频</span>
            <div class="flex items-center gap-4 mt-1" v-else-if="roleModes[role] === 3">
              <span class="text-[11px] text-white bg-orange-500 rounded px-2 py-0.5 shadow-sm font-medium">注意：<strong class="font-bold underline text-white">平静(neutral)</strong> 为主声源。其余情感用此全局权重与下方向量控制调优。</span>
              <div class="flex items-center gap-2 flex-1 max-w-[200px]">
                <span class="text-xs text-gray-700 font-bold whitespace-nowrap">全局情感权重:</span>
                <el-slider v-model="roleEmoAlphas[role]" :min="0" :max="1" :step="0.05" size="small" class="flex-1" />
              </div>
            </div>
            <span class="text-[11px] text-white bg-orange-500 rounded px-2 py-0.5 self-start shadow-sm font-medium" v-else>注意：<strong class="font-bold underline text-white">平静(neutral)</strong> 所绑定的音频将被作为此角色永远的主声源。其余情感直接微调。</span>
          </div>

          <!-- 情感维度网格：2列 -->
          <div class="grid grid-cols-2 gap-0 divide-x divide-y divide-gray-100">
            <div v-for="dim in EMOTION_DIMS" :key="dim.value" class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
              <!-- 情感标签 -->
              <div class="flex items-center gap-1.5 w-20 shrink-0">
                <!-- <span class="text-lg leading-none">{{ dim.emoji }}</span> -->
                <span class="text-sm font-semibold" :style="{ color: dim.color }">{{ dim.label }}</span>
              </div>

              <!-- 右侧配置区 -->
              <!-- 右侧配置区 -->
              <div class="flex-1 flex flex-col justify-center min-w-0 py-1">
                <template v-if="ttsProvider === 'indextts2'">
                  <!-- 模式 1: 只要选择框 -->
                  <div v-show="roleModes[role] === 1" class="flex gap-2 min-w-0">
                    <el-select v-model="localBindings[role][dim.value].id" placeholder="请选择参考音频" clearable size="small" class="flex-1 min-w-0">
                      <el-option v-for="audio in audioList" :key="audio.id" :label="audio.name" :value="audio.id" />
                    </el-select>
                  </div>

                  <!-- 模式 2: 选择框 + 权重 -->
                  <div v-show="roleModes[role] === 2" class="flex flex-col gap-1.5 min-w-0 w-full">
                    <el-select v-model="localBindings[role][dim.value].id" :placeholder="dim.value === 'neutral' ? '必填: 主底色音频' : '情感附加音频'" clearable size="small" class="w-full">
                      <el-option v-for="audio in audioList" :key="audio.id" :label="audio.name" :value="audio.id" />
                    </el-select>
                    <div v-if="dim.value !== 'neutral'" class="flex items-center gap-2">
                      <span class="text-[10px] text-gray-500 whitespace-nowrap">附加权重</span>
                      <el-slider v-model="localBindings[role][dim.value].emoWeight" :min="0" :max="1" :step="0.05" size="small" class="flex-1 ml-1 mr-2" />
                    </div>
                  </div>

                  <!-- 模式 3: 主音色选框 / 其他全为权重 -->
                  <div v-show="roleModes[role] === 3" class="flex flex-col gap-1 min-w-0 w-full justify-center">
                    <template v-if="dim.value === 'neutral'">
                      <el-select v-model="localBindings[role][dim.value].id" placeholder="必填项: 此角色的本底主发声音频" clearable size="small" class="w-full">
                        <el-option v-for="audio in audioList" :key="audio.id" :label="audio.name" :value="audio.id" />
                      </el-select>
                    </template>
                    <template v-else>
                      <div class="flex items-center gap-2 pt-1 h-full">
                        <span class="text-[11px] font-bold text-gray-500 whitespace-nowrap">此项情感强度</span>
                        <el-slider v-model="localBindings[role][dim.value].emoWeight" :min="0" :max="1" :step="0.05" size="small" class="flex-1 ml-1 mr-4" />
                      </div>
                    </template>
                  </div>
                </template>
                <template v-else>
                  <!-- 选择框 -->
                  <el-select v-model="localBindings[role][dim.value].id" placeholder="未绑定" clearable size="small" class="flex-1 min-w-0">
                    <el-option v-for="audio in audioList" :key="audio.id" :label="audio.name" :value="audio.id" />
                  </el-select>
                </template>
              </div>

              <!-- 试听按钮 -->
              <el-button v-show="localBindings[role][dim.value].id && (roleModes[role] !== 3 || dim.value === 'neutral')" circle type="info" plain size="small" title="试听该音频" @click="playAudio(localBindings[role][dim.value].id)" class="self-center">
                <el-icon><VideoPlay /></el-icon>
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部操作区 -->
      <div class="mt-4 flex justify-end gap-3 shrink-0 pt-3 border-t border-gray-100">
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存全局配置</el-button>
      </div>
    </div>

    <audio ref="previewPlayer" class="hidden" @ended="isPlaying = false"></audio>
  </el-dialog>
</template>

<script setup>
import { ref, defineExpose } from "vue";
import { InfoFilled, VideoPlay } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import axios from "axios";

// 8种情感维度定义
const EMOTION_DIMS = [
  { label: "高兴", value: "happy", emoji: "😄", color: "#f59e0b" },
  { label: "愤怒", value: "angry", emoji: "😠", color: "#ef4444" },
  { label: "悲伤", value: "sad", emoji: "😢", color: "#3b82f6" },
  { label: "害怕", value: "fearful", emoji: "😨", color: "#8b5cf6" },
  { label: "厌恶", value: "disgusted", emoji: "🤢", color: "#10b981" },
  { label: "忧郁", value: "melancholy", emoji: "😔", color: "#6366f1" },
  { label: "惊讶", value: "surprised", emoji: "😮", color: "#ec4899" },
  { label: "平静", value: "neutral", emoji: "😌", color: "#64748b" },
];

const dialogVisible = ref(false);
const loading = ref(false);
const saving = ref(false);

const uniqueRoles = ref([]);
const audioList = ref([]);
const localBindings = ref({});
const ttsProvider = ref("siliconflow");
const roleModes = ref({});
const roleEmoAlphas = ref({});

const previewPlayer = ref(null);
const isPlaying = ref(false);

const handleRoleModeChange = (role) => {
  const mode = roleModes.value[role];
  if (localBindings.value[role]) {
    EMOTION_DIMS.forEach((dim) => {
      localBindings.value[role][dim.value].mode = mode;
      // 当切换到纯向量控制模式时，清零其余情绪的权重，因为这部分变成向量数组的对应值，默认应该让用户拉动
      if (mode === 3 && dim.value !== "neutral") {
        localBindings.value[role][dim.value].emoWeight = 0;
      }
    });
  }
};

const openDialog = async (roles) => {
  // 旁白始终排在第一位
  const sorted = [...(roles || [])];
  const idx = sorted.indexOf("旁白");
  if (idx > 0) {
    sorted.splice(idx, 1);
    sorted.unshift("旁白");
  }
  uniqueRoles.value = sorted;

  // 提前初始化 localBindings 骨架，避免模板在加载前访问 undefined
  const skeleton = {};
  const skeletonModes = {};
  const skeletonAlphas = {};
  uniqueRoles.value.forEach((role) => {
    skeleton[role] = {};
    skeletonModes[role] = 1;
    skeletonAlphas[role] = 0.6;
    EMOTION_DIMS.forEach((dim) => {
      skeleton[role][dim.value] = { id: null, mode: 1, emoWeight: 0.65 };
    });
  });
  localBindings.value = skeleton;
  roleModes.value = skeletonModes;
  roleEmoAlphas.value = skeletonAlphas;

  dialogVisible.value = true;
  await fetchProvider();
  await fetchData();
};

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

const fetchData = async () => {
  loading.value = true;
  try {
    const audioRes = await axios.get("http://localhost:3000/api/audio/list");
    if (audioRes.data.success) {
      audioList.value = audioRes.data.list;
    }

    const globalRes = await axios.get("http://localhost:3000/api/audio/global-roles");
    if (globalRes.data.success) {
      const globalRoles = globalRes.data.roles;
      const newBindings = {};
      uniqueRoles.value.forEach((role) => {
        newBindings[role] = {};

        let rMode = 1;
        let rAlpha = 0.6;
        const nDetail = globalRoles[role]?.["neutral"];
        if (nDetail && nDetail.mode) {
          rMode = nDetail.mode;
          if (nDetail.emoAlpha !== undefined) rAlpha = nDetail.emoAlpha;
        } else {
          for (const em of EMOTION_DIMS) {
            if (globalRoles[role]?.[em.value]?.mode) {
              rMode = globalRoles[role][em.value].mode;
              break;
            }
          }
        }
        roleModes.value[role] = rMode;
        roleEmoAlphas.value[role] = rAlpha;

        EMOTION_DIMS.forEach((dim) => {
          const audioDetail = globalRoles[role]?.[dim.value];
          if (audioDetail) {
            newBindings[role][dim.value] = {
              id: audioDetail.id || null,
              mode: rMode,
              emoWeight: audioDetail.emoWeight !== undefined ? audioDetail.emoWeight : 0.65,
            };
          } else {
            newBindings[role][dim.value] = { id: null, mode: rMode, emoWeight: 0.65 };
          }
        });
      });
      localBindings.value = newBindings;
    }
  } catch (error) {
    ElMessage.error("加载配置失败");
    console.error(error);
  } finally {
    loading.value = false;
  }
};

const playAudio = (audioId) => {
  const audio = audioList.value.find((a) => a.id === audioId);
  if (audio && previewPlayer.value) {
    previewPlayer.value.src = "http://localhost:3000" + audio.url;
    previewPlayer.value.play();
    isPlaying.value = true;
  }
};

const emit = defineEmits(["saved"]);

const handleSave = async () => {
  saving.value = true;
  try {
    const cleanBindings = {};
    for (const role in localBindings.value) {
      cleanBindings[role] = { ...localBindings.value[role] };
      // 将全局的情感权重 (emoAlpha) 保存到该角色的基础配置(neutral)里以便下发利用
      if (cleanBindings[role]["neutral"]) {
        cleanBindings[role]["neutral"].emoAlpha = roleEmoAlphas.value[role];
      }
    }

    const res = await axios.post("http://localhost:3000/api/audio/global-roles", {
      bindings: cleanBindings,
    });

    if (res.data.success) {
      ElMessage.success("全局角色绑定配置保存成功");
      dialogVisible.value = false;
      emit("saved", cleanBindings);
    }
  } catch (error) {
    ElMessage.error("保存配置失败");
  } finally {
    saving.value = false;
  }
};

defineExpose({ openDialog });
</script>
