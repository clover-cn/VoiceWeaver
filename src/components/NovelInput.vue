<template>
  <div class="h-full flex flex-col bg-slate-50 border-r border-gray-200">
    <!-- 头部 -->
    <div class="p-4 bg-white border-b border-gray-200 flex flex-wrap justify-between items-center gap-2 shrink-0">
      <h2 class="text-lg font-bold text-gray-800 flex items-center gap-2">
        <el-icon><Document /></el-icon> 小说原文输入
      </h2>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <span class="text-xs text-gray-500">当前章节</span>
        <el-input-number v-model="chapterIndex" :min="0" :step="1" controls-position="right" size="small" class="w-32" placeholder="可选" />
        <el-button type="info" plain size="small" @click="openPrescanEditor" title="按章节填写当前章节和后续章节，供生命周期预扫描使用">
          编辑预扫描窗口
        </el-button>
        <el-button type="success" plain :loading="isPrescanning" @click="handlePrescan" title="提前提取角色并建立全局角色档案">全局角色预扫描</el-button>
        <el-button type="primary" :loading="isParsing" @click="handleParseText">
          开始智能拆解 <el-icon class="ml-1"><Right /></el-icon>
        </el-button>
      </div>
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

    <el-dialog v-model="prescanDialogVisible" title="预扫描章节窗口" width="760px" destroy-on-close>
      <div class="flex flex-col gap-4">
        <el-alert
          title="建议按顺序填写当前章节及后续章节"
          description="服务端会根据章节窗口判断临时角色是否还会出现，并在窗口完整时释放不再使用的声线。最多使用服务端配置的预扫描章节数。"
          type="info"
          :closable="false"
        />

        <div v-if="prescanChapters.length" class="max-h-[52vh] overflow-y-auto pr-2 space-y-3">
          <div v-for="(chapter, index) in prescanChapters" :key="chapter.id" class="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-sm font-semibold text-gray-700">第 {{ index + 1 }} 个窗口章节</span>
              <el-input-number v-model="chapter.chapterIndex" :min="0" :step="1" controls-position="right" size="small" class="w-32" />
              <el-input v-model="chapter.chapterTitle" size="small" placeholder="章节标题（可选）" class="flex-1" />
              <el-button link type="danger" :disabled="prescanChapters.length === 1" @click="removePrescanChapter(index)">删除</el-button>
            </div>
            <el-input v-model="chapter.text" type="textarea" :autosize="{ minRows: 4, maxRows: 10 }" resize="none" placeholder="粘贴这一章正文" />
          </div>
        </div>
        <el-empty v-else description="还没有章节窗口，请添加一章" :image-size="72" />

        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-500">空章节不会提交；章节序号允许从 0 开始。</span>
          <el-button type="primary" plain @click="addPrescanChapter"><el-icon class="mr-1"><Plus /></el-icon>添加章节</el-button>
        </div>
      </div>

      <template #footer>
        <el-button @click="prescanDialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="prescanDialogVisible = false">保存窗口</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { Document, Right, Plus } from "@element-plus/icons-vue";
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

const emit = defineEmits(["onParsed", "onTextChanged", "onPrescanSuccess"]);

const novelText = ref("");
const isParsing = ref(false);
const isPrescanning = ref(false);
const chapterIndex = ref(null);
const prescanDialogVisible = ref(false);
const prescanChapters = ref([]);
let prescanChapterId = 0;

const createPrescanChapter = ({ chapterIndex: index = null, chapterTitle = "", text = "" } = {}) => ({
  id: `prescan-${++prescanChapterId}`,
  chapterIndex: index,
  chapterTitle,
  text,
});

// 监听项目切换，清空当前输入，使得新项目有一个干净的输入栏
watch(
  () => props.projectName,
  () => {
    novelText.value = "";
    chapterIndex.value = null;
    prescanChapters.value = [];
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

const openPrescanEditor = () => {
  if (!prescanChapters.value.length) {
    prescanChapters.value = [
      createPrescanChapter({
        chapterIndex: Number.isInteger(chapterIndex.value) ? chapterIndex.value : 0,
        text: novelText.value,
      }),
    ];
  }
  prescanDialogVisible.value = true;
};

const addPrescanChapter = () => {
  const lastChapter = prescanChapters.value[prescanChapters.value.length - 1];
  const lastIndex = Number.isInteger(Number(lastChapter?.chapterIndex)) ? Number(lastChapter.chapterIndex) : -1;
  prescanChapters.value.push(createPrescanChapter({ chapterIndex: lastIndex + 1 }));
};

const removePrescanChapter = (index) => {
  if (prescanChapters.value.length <= 1) return;
  prescanChapters.value.splice(index, 1);
};

const getPrescanPayload = () => {
  const chapters = prescanChapters.value
    .map((chapter, offset) => ({
      chapterIndex: Number.isInteger(Number(chapter.chapterIndex)) ? Number(chapter.chapterIndex) : offset,
      chapterTitle: String(chapter.chapterTitle || "").trim(),
      text: String(chapter.text || "").trim(),
    }))
    .filter((chapter) => chapter.text);

  if (chapters.length) {
    return {
      chapters,
      combinedText: chapters
        .map((chapter) => `${chapter.chapterTitle ? `${chapter.chapterTitle}\n` : ""}${chapter.text}`.trim())
        .join("\n\n"),
    };
  }

  return { combinedText: novelText.value.trim() };
};

// 监听用户输入并抛出给顶层保存草稿
watch(novelText, (newVal) => {
  emit("onTextChanged", newVal);
});

const handlePrescan = async () => {
  const prescanPayload = getPrescanPayload();
  if (!prescanPayload.combinedText && !prescanPayload.chapters?.length) {
    ElMessage.warning("请在此处粘贴前几章文本（建议10章左右）作为预扫描语料！");
    return;
  }

  isPrescanning.value = true;
  ElMessage.info("开始全局角色预扫描，这可能需要1-2分钟...");
  try {
    const res = await axios.post("http://localhost:3000/api/llm/prescan-characters", {
      ...prescanPayload,
      projectName: props.projectName,
    });
    if (res.data.success) {
      ElMessage.success("全局角色预扫描完成！已建立角色档案。");
      emit("onPrescanSuccess", res.data.data, res.data);
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || "预扫描接口出错，请检查 LLM 配置并重启");
  } finally {
    isPrescanning.value = false;
  }
};

const handleParseText = async () => {
  if (!novelText.value.trim()) {
    ElMessage.warning("请输入小说原文！");
    return;
  }

  isParsing.value = true;
  try {
    // 调用后端 LLM 解析
    const payload = {
      text: novelText.value,
      projectName: props.projectName,
    };
    if (Number.isInteger(chapterIndex.value) && chapterIndex.value >= 0) {
      payload.chapterIndex = chapterIndex.value;
    }

    const res = await axios.post("http://localhost:3000/api/llm/parse", payload);
    if (res.data.success) {
      ElMessage.success("文本解析成功！右侧已更新");
      emit("onParsed", res.data.data, res.data.characters, res.data.autoCasting || null);
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
