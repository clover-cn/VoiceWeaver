<template>
  <el-dialog v-model="dialogVisible" title="全局角色参考音频配置" width="60%" destroy-on-close>
    <div class="flex flex-col h-[50vh]">
      <div class="mb-4 text-sm text-gray-500 bg-blue-50 p-3 rounded border border-blue-100 flex items-start gap-2">
        <el-icon class="text-blue-500 mt-0.5"><InfoFilled /></el-icon>
        <div>
          <p>此处提取了当前小说当前列表内出现的所有角色。</p>
          <p>您可以为每个角色绑定参考音频。一旦绑定，它将在此系统内全局生效（即使在其他小说项目遇到同名角色也会默认应用绑定）。</p>
        </div>
      </div>
      
      <div class="flex-1 overflow-y-auto pr-2">
        <div v-if="loading" class="py-10 text-center text-gray-400">加载数据中...</div>
        <div v-else-if="uniqueRoles.length === 0" class="py-10 text-center text-gray-400">当前左侧没有提取到任何角色</div>
        <div v-else class="space-y-3">
          <div 
            v-for="role in uniqueRoles" 
            :key="role" 
            class="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div class="font-bold text-gray-800 w-1/3 truncate" :title="role">
              {{ role }}
            </div>
            <div class="flex-1 flex items-center justify-end gap-3">
              <el-select 
                v-model="localBindings[role]" 
                placeholder="选择绑定的参考音频" 
                clearable 
                class="w-64"
                size="default"
              >
                <el-option
                  v-for="audio in audioList"
                  :key="audio.id"
                  :label="audio.name"
                  :value="audio.id"
                />
              </el-select>
              
              <!-- 快捷试听选中的音频 -->
              <div class="w-8 flex items-center justify-center">
                <el-button 
                  v-if="localBindings[role]" 
                  circle 
                  type="info" 
                  plain 
                  size="small"
                  title="试听"
                  @click="playAudio(localBindings[role])"
                >
                  <el-icon><VideoPlay /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-6 flex justify-end gap-3 shrink-0">
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存全局配置</el-button>
      </div>
    </div>
    
    <!-- 隐藏的播放器用于试听 -->
    <audio ref="previewPlayer" class="hidden" @ended="isPlaying = false"></audio>
  </el-dialog>
</template>

<script setup>
import { ref, defineExpose, computed } from 'vue';
import { InfoFilled, VideoPlay } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import axios from 'axios';

const dialogVisible = ref(false);
const loading = ref(false);
const saving = ref(false);

const uniqueRoles = ref([]);
const audioList = ref([]);
const localBindings = ref({}); // 当前弹窗内的绑定状态 { "张三": "audioId1" }

const previewPlayer = ref(null);
const isPlaying = ref(false);

// 打开弹窗并传入当前存在的角色列表
const openDialog = async (roles) => {
  uniqueRoles.value = roles || [];
  dialogVisible.value = true;
  await fetchData();
};

const fetchData = async () => {
  loading.value = true;
  try {
    // 1. 获取所有的参考音频选项
    const audioRes = await axios.get('http://localhost:3000/api/audio/list');
    if (audioRes.data.success) {
      audioList.value = audioRes.data.list;
    }

    // 2. 获取当前的全局绑定记录
    const globalRes = await axios.get('http://localhost:3000/api/audio/global-roles');
    if (globalRes.data.success) {
      const globalRoles = globalRes.data.roles;
      
      // 初始化 localBindings
      const newBindings = {};
      uniqueRoles.value.forEach(role => {
         if (globalRoles[role]) {
             newBindings[role] = globalRoles[role].id;
         } else {
             newBindings[role] = null;
         }
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
    // 明确处理 clearable 带来的空值情况
    const cleanBindings = {};
    for (const role in localBindings.value) {
      if (!localBindings.value[role] || localBindings.value[role] === "") {
        cleanBindings[role] = null;
      } else {
        cleanBindings[role] = localBindings.value[role];
      }
    }

    // 调用后端接口提交变更
    const res = await axios.post('http://localhost:3000/api/audio/global-roles', {
       bindings: cleanBindings
    });
    
    if (res.data.success) {
      ElMessage.success('全局角色绑定配置保存成功');
      dialogVisible.value = false;
      // 通知上层，可能需要整体刷新当前界面的卡片属性
      emit('saved', cleanBindings);
    }
  } catch (error) {
    ElMessage.error('保存配置失败');
  } finally {
    saving.value = false;
  }
};

defineExpose({
  openDialog
});
</script>
