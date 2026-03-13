<template>
  <el-dialog v-model="dialogVisible" title="全局角色参考音频配置" width="72%" destroy-on-close>
    <div class="flex flex-col" style="max-height: 68vh;">

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
        <div
          v-for="role in uniqueRoles"
          :key="role"
          class="border border-gray-200 rounded-xl overflow-hidden"
        >
          <!-- 角色标题栏 -->
          <div class="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center gap-2">
            <span class="text-base font-bold text-gray-800">🎭 {{ role }}</span>
            <span class="text-xs text-gray-400">· 点击下方选择框为各情感绑定参考音频</span>
          </div>

          <!-- 情感维度网格：2列 -->
          <div class="grid grid-cols-2 gap-0 divide-x divide-y divide-gray-100">
            <div
              v-for="dim in EMOTION_DIMS"
              :key="dim.value"
              class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <!-- 情感标签 -->
              <div class="flex items-center gap-1.5 w-20 shrink-0">
                <span class="text-lg leading-none">{{ dim.emoji }}</span>
                <span class="text-sm font-semibold" :style="{ color: dim.color }">{{ dim.label }}</span>
              </div>

              <!-- 选择框 -->
              <el-select
                v-model="localBindings[role][dim.value]"
                placeholder="未绑定"
                clearable
                size="small"
                class="flex-1"
              >
                <el-option
                  v-for="audio in audioList"
                  :key="audio.id"
                  :label="audio.name"
                  :value="audio.id"
                />
              </el-select>

              <!-- 试听按钮 -->
              <el-button
                v-show="localBindings[role][dim.value]"
                circle
                type="info"
                plain
                size="small"
                title="试听该参考音频"
                @click="playAudio(localBindings[role][dim.value])"
              >
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
import { ref, defineExpose } from 'vue';
import { InfoFilled, VideoPlay } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import axios from 'axios';

// 8种情感维度定义
const EMOTION_DIMS = [
  { label: '高兴', value: 'happy',      emoji: '😄', color: '#f59e0b' },
  { label: '愤怒', value: 'angry',      emoji: '😠', color: '#ef4444' },
  { label: '悲伤', value: 'sad',        emoji: '😢', color: '#3b82f6' },
  { label: '害怕', value: 'fearful',    emoji: '😨', color: '#8b5cf6' },
  { label: '厌恶', value: 'disgusted',  emoji: '🤢', color: '#10b981' },
  { label: '忧郁', value: 'melancholy', emoji: '😔', color: '#6366f1' },
  { label: '惊讶', value: 'surprised',  emoji: '😮', color: '#ec4899' },
  { label: '平静', value: 'neutral',    emoji: '😌', color: '#64748b' },
];

const dialogVisible = ref(false);
const loading = ref(false);
const saving = ref(false);

const uniqueRoles = ref([]);
const audioList = ref([]);
const localBindings = ref({});

const previewPlayer = ref(null);
const isPlaying = ref(false);

const openDialog = async (roles) => {
  // 旁白始终排在第一位
  const sorted = [...(roles || [])];
  const idx = sorted.indexOf('旁白');
  if (idx > 0) {
    sorted.splice(idx, 1);
    sorted.unshift('旁白');
  }
  uniqueRoles.value = sorted;

  // 提前初始化 localBindings 骨架，避免模板在加载前访问 undefined
  const skeleton = {};
  uniqueRoles.value.forEach(role => {
    skeleton[role] = {};
    EMOTION_DIMS.forEach(dim => { skeleton[role][dim.value] = null; });
  });
  localBindings.value = skeleton;

  dialogVisible.value = true;
  await fetchData();
};

const fetchData = async () => {
  loading.value = true;
  try {
    const audioRes = await axios.get('http://localhost:3000/api/audio/list');
    if (audioRes.data.success) {
      audioList.value = audioRes.data.list;
    }

    const globalRes = await axios.get('http://localhost:3000/api/audio/global-roles');
    if (globalRes.data.success) {
      const globalRoles = globalRes.data.roles;
      const newBindings = {};
      uniqueRoles.value.forEach(role => {
        newBindings[role] = {};
        EMOTION_DIMS.forEach(dim => {
          const audioDetail = globalRoles[role]?.[dim.value];
          newBindings[role][dim.value] = audioDetail ? audioDetail.id : null;
        });
      });
      localBindings.value = newBindings;
    }
  } catch (error) {
    ElMessage.error('加载配置失败');
    console.error(error);
  } finally {
    loading.value = false;
  }
};

const playAudio = (audioId) => {
  const audio = audioList.value.find(a => a.id === audioId);
  if (audio && previewPlayer.value) {
    previewPlayer.value.src = 'http://localhost:3000' + audio.url;
    previewPlayer.value.play();
    isPlaying.value = true;
  }
};

const emit = defineEmits(['saved']);

const handleSave = async () => {
  saving.value = true;
  try {
    const cleanBindings = {};
    for (const role in localBindings.value) {
      cleanBindings[role] = { ...localBindings.value[role] };
    }

    const res = await axios.post('http://localhost:3000/api/audio/global-roles', {
      bindings: cleanBindings
    });

    if (res.data.success) {
      ElMessage.success('全局角色绑定配置保存成功');
      dialogVisible.value = false;
      emit('saved', cleanBindings);
    }
  } catch (error) {
    ElMessage.error('保存配置失败');
  } finally {
    saving.value = false;
  }
};

defineExpose({ openDialog });
</script>
