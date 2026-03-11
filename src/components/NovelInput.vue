<template>
  <div class="h-full flex flex-col bg-slate-50 border-r border-gray-200">
    <!-- 头部 -->
    <div class="p-4 bg-white border-b border-gray-200 flex justify-between items-center shrink-0">
      <h2 class="text-lg font-bold text-gray-800 flex items-center gap-2">
        <el-icon><Document /></el-icon> 小说原文输入
      </h2>
      <el-button type="primary" :loading="isParsing" @click="handleParseText">
        AI 智能拆解解析 <el-icon class="ml-1"><Right /></el-icon>
      </el-button>
    </div>

    <!-- 文本框 -->
    <div class="flex-1 p-4 overflow-hidden relative">
      <el-input
        v-model="novelText"
        type="textarea"
        placeholder="请在此处粘贴要进行多角色配音的小说文本。建议单次不超过 2000 字以获得最佳解析效果..."
        class="h-full w-full rounded-md shadow-sm border-gray-300"
        resize="none"
        :input-style="{ height: '100%', padding: '16px', fontSize: '15px', lineHeight: '1.7', backgroundColor: '#fdfdfd' }"
      />
      <div class="absolute bottom-6 right-8 text-sm text-gray-400 select-none">字数: {{ novelText.length }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { Document, Right } from "@element-plus/icons-vue";
import axios from "axios";
import { ElMessage } from "element-plus";

const props = defineProps({
  projectName: {
    type: String,
    default: "",
  },
  initialText: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["onParsed", "onTextChanged"]);

const novelText = ref("");
const isParsing = ref(false);

// 监听项目切换，清空当前输入，使得新项目有一个干净的输入栏
watch(
  () => props.projectName,
  () => {
    novelText.value = "";
  },
);

// 监听从后端拉取恢复过来的草稿数据
watch(
  () => props.initialText,
  (newVal) => {
    if (novelText.value !== newVal) {
      novelText.value = newVal;
    }
  },
);

// 监听用户输入并抛出给顶层保存草稿
watch(novelText, (newVal) => {
  emit("onTextChanged", newVal);
});

const handleParseText = async () => {
  if (!novelText.value.trim()) {
    ElMessage.warning("请输入小说原文！");
    return;
  }

  isParsing.value = true;
  try {
    // 调用后端 LLM 解析
    const res = await axios.post("http://localhost:3000/api/llm/parse", {
      text: novelText.value,
      projectName: props.projectName,
    });
    if (res.data.success) {
      ElMessage.success("文本解析成功！右侧已更新");
      emit("onParsed", res.data.data, res.data.characters);
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || "解析接口出错，请开后检查 LLM 配置并重启");
  } finally {
    isParsing.value = false;
  }
};
</script>

<style scoped>
/* 可按需增加深度修改，这里靠 tailwind 驱动主框架 */
:deep(.el-textarea__inner:focus) {
  box-shadow: 0 0 0 1px var(--el-color-primary) inset !important;
}
</style>
