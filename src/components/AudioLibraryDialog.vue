<template>
  <el-dialog v-model="dialogVisible" title="参考音频管理中心" width="70%" destroy-on-close>
    <div class="flex flex-col h-[60vh] gap-4">
      <!-- 顶部操作栏 -->
      <div class="flex justify-between items-center bg-gray-50 p-4 rounded-lg">
        <h3 class="text-sm font-semibold text-gray-700">音频素材库</h3>
        <el-upload
          class="upload-demo"
          action="http://localhost:3000/api/audio/upload"
          :show-file-list="false"
          :on-success="handleUploadSuccess"
          :on-error="handleUploadError"
          :before-upload="beforeUpload"
          accept="audio/*"
        >
          <el-button type="primary"><el-icon class="mr-1"><UploadFilled /></el-icon>点击上传音频</el-button>
        </el-upload>
      </div>

      <!-- 列表区域 -->
      <div class="flex-1 overflow-y-auto w-full relative">
        <el-table
          v-loading="loading"
          :data="audioList"
          style="width: 100%"
          :border="true"
          stripe
          height="100%"
        >
          <el-table-column prop="name" label="音频名称" min-width="150" show-overflow-tooltip>
            <template #default="scope">
              <span class="font-medium text-gray-800">{{ scope.row.name }}</span>
            </template>
          </el-table-column>
          <el-table-column label="试听" width="280">
            <template #default="scope">
              <audio :src="'http://localhost:3000' + scope.row.url" controls class="h-8 w-full outline-none"></audio>
            </template>
          </el-table-column>
          <el-table-column prop="createTime" label="上传时间" width="180">
            <template #default="scope">
              {{ formatDate(scope.row.createTime) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="scope">
              <el-popconfirm title="确定要删除这段音频吗？会同时清除其在角色上的绑定" @confirm="handleDelete(scope.row.id)">
                <template #reference>
                  <el-button link type="danger" size="small">删除</el-button>
                </template>
              </el-popconfirm>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="!loading && audioList.length === 0" class="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-white bg-opacity-90">
          <el-icon :size="48" class="mb-2"><Box /></el-icon>
          <p>暂无参考音频，请上传</p>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, defineExpose } from 'vue';
import { UploadFilled, Box } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import axios from 'axios';

const dialogVisible = ref(false);
const loading = ref(false);
const audioList = ref([]);

// 供父组件调用的方法打开弹窗
const openDialog = () => {
  dialogVisible.value = true;
  fetchAudioList();
};

const fetchAudioList = async () => {
  loading.value = true;
  try {
    const res = await axios.get('http://localhost:3000/api/audio/list');
    if (res.data.success) {
      audioList.value = res.data.list || [];
    }
  } catch (error) {
    ElMessage.error('获取音频库失败');
  } finally {
    loading.value = false;
  }
};

const beforeUpload = (file) => {
  // 简单的校验
  if (!file.type.startsWith('audio/')) {
    ElMessage.error('只能上传音频文件！');
    return false;
  }
  const isLt50M = file.size / 1024 / 1024 < 50;
  if (!isLt50M) {
    ElMessage.error('上传音频大小不能超过 50MB!');
    return false;
  }
  return true;
};

const handleUploadSuccess = (res) => {
  if (res.success) {
    ElMessage.success('上传成功');
    fetchAudioList(); // 重新加载列表
  } else {
    ElMessage.error(res.error || '上传失败');
  }
};

const handleUploadError = () => {
  ElMessage.error('文件上传失败，请检查网络或服务端状态');
};

const handleDelete = async (id) => {
  try {
    const res = await axios.delete(`http://localhost:3000/api/audio/${id}`);
    if (res.data.success) {
      ElMessage.success('删除成功');
      fetchAudioList();
    }
  } catch (error) {
    ElMessage.error('删除失败');
  }
};

const formatDate = (isoStr) => {
  if (!isoStr) return '';
  const date = new Date(isoStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

defineExpose({
  openDialog
});
</script>

<style scoped>
/* 可选的样式微调 */
:deep(.el-table .cell) {
  display: flex;
  align-items: center;
}
</style>
