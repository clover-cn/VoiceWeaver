<template>
  <el-dialog v-model="dialogVisible" title="参考音频管理中心" width="78%" destroy-on-close>
    <div class="flex flex-col h-[60vh] gap-4">
      <!-- 顶部操作栏 -->
      <div class="flex justify-between items-center bg-gray-50 p-4 rounded-lg">
        <div>
          <h3 class="text-sm font-semibold text-gray-700">音频素材库</h3>
          <p class="text-xs text-gray-500 mt-1">每个声线只需设置一次音频池，保存后会同步该声线的全部情绪音频。</p>
        </div>
        <el-upload
          class="upload-demo"
          action="http://localhost:3000/api/audio/upload"
          :show-file-list="false"
          :on-success="handleUploadSuccess"
          :on-error="handleUploadError"
          :before-upload="beforeUpload"
          accept="audio/*"
        >
          <el-button type="primary"
            ><el-icon class="mr-1"><UploadFilled /></el-icon>点击上传音频</el-button
          >
        </el-upload>
      </div>

      <el-alert
        title="声线由音频名称识别"
        description="例如“刻晴-生气-女”和“刻晴-平静-女”会归为同一个声线。请使用“角色-情绪-性别”的命名格式，未识别名称无法按声线批量修改。"
        type="info"
        :closable="false"
      />

      <!-- 列表区域 -->
      <div class="flex-1 overflow-y-auto w-full relative">
        <el-table v-loading="loading" :data="voiceActorGroups" row-key="key" style="width: 100%" :border="true" stripe height="100%">
          <el-table-column type="expand" width="48">
            <template #default="scope">
              <div class="p-3 bg-gray-50 space-y-3">
                <div v-for="audio in scope.row.records" :key="audio.id" class="rounded-lg border border-gray-200 bg-white p-3">
                  <div class="flex items-center justify-between gap-3 mb-3">
                    <div class="min-w-0">
                      <div class="font-medium text-gray-800 truncate" :title="audio.name">{{ audio.name }}</div>
                      <div class="text-xs text-gray-400 mt-1">{{ formatDate(audio.createTime) }}</div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <audio :src="'http://localhost:3000' + audio.url" controls class="h-8 w-64 outline-none"></audio>
                      <el-popconfirm title="确定要删除这段音频吗？会同时清除其在角色上的绑定" @confirm="handleDelete(audio.id)">
                        <template #reference>
                          <el-button link type="danger" size="small">删除</el-button>
                        </template>
                      </el-popconfirm>
                    </div>
                  </div>

                  <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <el-input
                      v-if="isSiliconflow"
                      v-model="audio.sampleText"
                      type="textarea"
                      :autosize="{ minRows: 1, maxRows: 3 }"
                      placeholder="输入该音频对应的参考文本"
                      @blur="handleSampleTextSave(audio)"
                      @keydown.enter.ctrl="handleSampleTextSave(audio)"
                    />
                    <el-input
                      v-model="audio.remark"
                      type="textarea"
                      :autosize="{ minRows: 1, maxRows: 3 }"
                      placeholder="添加备注"
                      @blur="handleRemarkSave(audio)"
                      @keydown.enter.ctrl="handleRemarkSave(audio)"
                    />
                  </div>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="声线" min-width="220" show-overflow-tooltip>
            <template #default="scope">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-gray-800">{{ scope.row.voiceActor || "未识别声线" }}</span>
                <el-tag size="small" type="info">{{ scope.row.records.length }} 条</el-tag>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="音频池" width="180">
            <template #default="scope">
              <el-select
                :model-value="getGroupPool(scope.row)"
                size="small"
                class="w-full"
                :disabled="!scope.row.voiceActor"
                @update:model-value="setGroupPool(scope.row, $event)"
              >
                <el-option v-for="pool in voicePoolOptions" :key="pool.value" :label="pool.label" :value="pool.value" />
              </el-select>
              <div v-if="scope.row.mixedPool" class="text-[11px] text-amber-600 mt-1">历史配置不一致</div>
            </template>
          </el-table-column>

          <el-table-column label="情绪音频" min-width="240">
            <template #default="scope">
              <div class="flex flex-wrap gap-1">
                <el-tag v-for="audio in scope.row.records" :key="audio.id" size="small" effect="plain">{{ getAudioEmotion(audio) }}</el-tag>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="150" fixed="right">
            <template #default="scope">
              <el-button size="small" type="primary" plain :loading="isSavingPool(scope.row.key)" :disabled="!scope.row.voiceActor" @click="handlePoolSave(scope.row)">保存音频池</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="!loading && voiceActorGroups.length === 0" class="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-white bg-opacity-90">
          <el-icon :size="48" class="mb-2"><Box /></el-icon>
          <p>暂无参考音频，请上传</p>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { computed, ref, defineExpose } from "vue";
import { UploadFilled, Box } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import axios from "axios";

const dialogVisible = ref(false);
const loading = ref(false);
const audioList = ref([]);
const savingPoolKeys = ref(new Set());
const poolDrafts = ref({});
const voicePoolOptions = [
  { value: "general", label: "通用池" },
  { value: "bystander", label: "路人池" },
  { value: "protected", label: "保护池" },
];
// 当前 TTS 提供商，默认 siliconflow
const ttsProvider = ref("siliconflow");
const isSiliconflow = ref(true);

// 供父组件调用的方法打开弹窗
const openDialog = async () => {
  dialogVisible.value = true;
  await fetchProvider();
  await fetchAudioList();
};

// 获取当前 TTS 提供商
const fetchProvider = async () => {
  try {
    const res = await axios.get("http://localhost:3000/api/tts/provider");
    if (res.data.success) {
      ttsProvider.value = res.data.provider;
      isSiliconflow.value = res.data.provider === "siliconflow";
    }
  } catch (error) {
    console.warn("获取 TTS 提供商失败，默认使用 siliconflow 模式");
  }
};

const fetchAudioList = async () => {
  loading.value = true;
  try {
    const res = await axios.get("http://localhost:3000/api/audio/list");
    if (res.data.success) {
      // 旧数据可能仍带 voiceTags，前端不再读取或展示该字段。
      audioList.value = (res.data.list || []).map((item) => {
        const { voiceTags: _legacyVoiceTags, ...cleanItem } = item || {};
        return {
          ...cleanItem,
          sampleText: item.sampleText || "",
          remark: item.remark || "",
          voicePool: item.voicePool || "general",
        };
      });
      poolDrafts.value = buildPoolDrafts(audioList.value);
    }
  } catch (error) {
    ElMessage.error("获取音频库失败");
  } finally {
    loading.value = false;
  }
};

const isSavingPool = (key) => savingPoolKeys.value.has(key);

const getVoiceActor = (row) => {
  const name = String(row?.name || "").trim();
  const parts = name
    .split("-")
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts[0] : "";
};

const getGroupKey = (record) => getVoiceActor(record) || `unparsed:${record?.id || "unknown"}`;

const getAudioEmotion = (record) => {
  const parts = String(record?.name || "")
    .split("-")
    .map((item) => item.trim())
    .filter(Boolean);
  return parts[1] || "未识别情绪";
};

const voiceActorGroups = computed(() => {
  const groups = new Map();
  audioList.value.forEach((record) => {
    const key = getGroupKey(record);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        voiceActor: getVoiceActor(record),
        records: [],
      });
    }
    groups.get(key).records.push(record);
  });

  return [...groups.values()].map((group) => {
    const pools = [...new Set(group.records.map((record) => record.voicePool || "general"))];
    return {
      ...group,
      configuredPool: pools.length === 1 ? pools[0] : "general",
      mixedPool: pools.length > 1,
    };
  });
});

const buildPoolDrafts = (records) => {
  const groupedPools = new Map();
  (records || []).forEach((record) => {
    const key = getGroupKey(record);
    if (!groupedPools.has(key)) groupedPools.set(key, new Set());
    groupedPools.get(key).add(record.voicePool || "general");
  });

  const drafts = {};
  groupedPools.forEach((pools, key) => {
    drafts[key] = pools.size === 1 ? [...pools][0] : "general";
  });
  return drafts;
};

const getGroupPool = (group) => {
  if (Object.prototype.hasOwnProperty.call(poolDrafts.value, group.key)) return poolDrafts.value[group.key];
  return group.configuredPool || "general";
};

const setGroupPool = (group, pool) => {
  poolDrafts.value = {
    ...poolDrafts.value,
    [group.key]: pool || "general",
  };
};

// 按声线一次性保存整套情绪音频的音频池。
const handlePoolSave = async (group) => {
  if (!group?.voiceActor || isSavingPool(group.key)) return;

  const nextSavingKeys = new Set(savingPoolKeys.value);
  nextSavingKeys.add(group.key);
  savingPoolKeys.value = nextSavingKeys;

  try {
    const res = await axios.post(`http://localhost:3000/api/audio/voice-actor/${encodeURIComponent(group.voiceActor)}/pool`, {
      voicePool: getGroupPool(group),
    });
    if (res.data.success) {
      const affectedCount = res.data.data?.affectedCount;
      ElMessage.success(affectedCount ? `「${group.voiceActor}」音频池已保存，共同步 ${affectedCount} 条音频` : "音频池已保存");
      await fetchAudioList();
    }
  } catch (error) {
    await fetchAudioList();
    ElMessage.error(error.response?.data?.error || "保存音频池失败");
  } finally {
    const remainingKeys = new Set(savingPoolKeys.value);
    remainingKeys.delete(group.key);
    savingPoolKeys.value = remainingKeys;
  }
};

// 保存参考文本（失焦或 Ctrl+Enter 触发）
const handleSampleTextSave = async (row) => {
  try {
    const res = await axios.post(`http://localhost:3000/api/audio/${row.id}/sample-text`, {
      sampleText: row.sampleText || "",
    });
    if (res.data.success) {
      ElMessage.success("参考文本已保存");
    }
  } catch (error) {
    ElMessage.error("保存参考文本失败");
  }
};

// 保存备注（失焦或 Ctrl+Enter 触发）
const handleRemarkSave = async (row) => {
  try {
    const res = await axios.post(`http://localhost:3000/api/audio/${row.id}/remark`, {
      remark: row.remark || "",
    });
    if (res.data.success) {
      ElMessage.success("备注已保存");
    }
  } catch (error) {
    ElMessage.error("保存备注失败");
  }
};

const beforeUpload = (file) => {
  // 简单的校验
  if (!file.type.startsWith("audio/")) {
    ElMessage.error("只能上传音频文件！");
    return false;
  }
  const isLt50M = file.size / 1024 / 1024 < 50;
  if (!isLt50M) {
    ElMessage.error("上传音频大小不能超过 50MB!");
    return false;
  }
  return true;
};

const handleUploadSuccess = (res) => {
  if (res.success) {
    ElMessage.success("上传成功");
    fetchAudioList(); // 重新加载列表
  } else {
    ElMessage.error(res.error || "上传失败");
  }
};

const handleUploadError = () => {
  ElMessage.error("文件上传失败，请检查网络或服务端状态");
};

const handleDelete = async (id) => {
  try {
    const res = await axios.delete(`http://localhost:3000/api/audio/${id}`);
    if (res.data.success) {
      ElMessage.success("删除成功");
      fetchAudioList();
    }
  } catch (error) {
    ElMessage.error("删除失败");
  }
};

const formatDate = (isoStr) => {
  if (!isoStr) return "";
  const date = new Date(isoStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
};

defineExpose({
  openDialog,
});
</script>

<style scoped>
/* 可选的样式微调 */
:deep(.el-table .cell) {
  display: flex;
  align-items: center;
}
</style>
