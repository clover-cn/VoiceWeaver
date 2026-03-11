<template>
  <div class="h-screen w-screen overflow-hidden flex flex-col font-sans bg-gray-50">
    <!-- 顶部导航栏 -->
    <header class="h-16 bg-white border-b border-gray-200 shadow-sm flex items-center px-6 shrink-0 justify-between z-10">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-bold text-xl shadow-md">Ai</div>
        <h1 class="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-800 to-gray-500 tracking-tight">
          织音<span class="text-sm ml-2 font-normal text-gradient-animate">多角色有声小说自动配音系统</span>
          <span v-if="currentProject" class="text-sm text-indigo-500 ml-2 bg-indigo-50 px-2 py-1 rounded">当前项目: {{ currentProject }}</span>
        </h1>
      </div>
      <div class="flex items-center gap-4 text-sm text-gray-500 font-medium">
        <el-button v-if="currentProject" size="small" @click="currentProject = null" type="info" plain class="mr-2">切换项目</el-button>
        <div class="flex items-center gap-1">
          <el-icon class="text-green-500"><CircleCheck /></el-icon> 服务已连接
        </div>
        <a href="https://github.com" target="_blank" class="hover:text-blue-600 transition-colors">使用文档</a>
      </div>
    </header>

    <!-- 主工作区(分屏视图) -->
    <main class="flex-1 flex overflow-hidden lg:flex-row flex-col relative">
      <!-- 项目选择器叠加层 -->
      <div v-if="!currentProject" class="absolute inset-0 z-50 bg-gray-50 flex flex-col items-center pt-20">
        <div class="bg-white p-8 rounded-xl shadow-lg border border-gray-200 w-full max-w-2xl">
          <h2 class="text-2xl font-bold text-gray-800 mb-6 text-center">选择或新建小说项目</h2>

          <div class="mb-8">
            <h3 class="text-sm font-semibold text-gray-500 mb-3 uppercase tracking-wider">创建新项目</h3>
            <div class="flex gap-2">
              <el-input v-model="newProjectName" placeholder="输入小说或项目名称..." class="flex-1" @keyup.enter="handleCreateProject"></el-input>
              <el-button type="primary" @click="handleCreateProject" :loading="isCreating">创建并进入</el-button>
            </div>
          </div>

          <div>
            <h3 class="text-sm font-semibold text-gray-500 mb-3 uppercase tracking-wider">已有项目</h3>
            <div v-if="isLoadingProjects" class="text-center text-gray-400 py-4">加载中...</div>
            <div v-else-if="projects.length === 0" class="text-center text-gray-400 py-4 border-2 border-dashed border-gray-200 rounded-lg">暂无历史项目，请在上方新建</div>
            <div v-else class="grid grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-2">
              <div
                v-for="proj in projects"
                :key="proj"
                class="border border-gray-200 rounded-lg p-4 cursor-pointer hover:border-blue-500 hover:shadow-md transition-all flex justify-between items-center group"
                @click="selectProject(proj)"
              >
                <span class="font-medium text-gray-700 truncate mr-2" :title="proj">{{ proj }}</span>
                <el-button link type="danger" size="small" class="opacity-0 group-hover:opacity-100" @click.stop="handleDeleteProject(proj)">删除</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 左窗格：输入 -->
      <section class="lg:w-[45%] w-full h-full" :class="{ 'opacity-20 pointer-events-none': !currentProject }">
        <NovelInput :projectName="currentProject" :initialText="currentNovelText" @onParsed="handleParsedData" @onTextChanged="handleTextChanged" />
      </section>

      <!-- 右窗格：验证和仪表板 -->
      <section class="lg:flex-1 w-full h-full relative shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.05)]" :class="{ 'opacity-20 pointer-events-none': !currentProject, 'z-0': currentProject }">
        <RoleVerifyCard :projectName="currentProject" :initialCards="currentParsedList" :globalCharacters="globalChars" @onCardsChanged="handleCardsChanged" />
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { CircleCheck } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import axios from "axios";
import NovelInput from "./components/NovelInput.vue";
import RoleVerifyCard from "./components/RoleVerifyCard.vue";

const currentParsedList = ref([]);
const globalChars = ref({});

// 项目状态
const currentProject = ref(null);
const projects = ref([]);
const isLoadingProjects = ref(false);
const newProjectName = ref("");
const isCreating = ref(false);
const currentNovelText = ref("");

const loadProjects = async () => {
  isLoadingProjects.value = true;
  try {
    const res = await axios.get("http://localhost:3000/api/projects");
    if (res.data.success) {
      projects.value = res.data.projects;
    }
  } catch (e) {
    ElMessage.error("无法加载项目列表，请检查服务端是否运行");
  } finally {
    isLoadingProjects.value = false;
  }
};

const saveDraft = async () => {
  if (!currentProject.value) return;
  try {
    await axios.post(`http://localhost:3000/api/projects/${currentProject.value}/draft`, {
      novelText: currentNovelText.value,
      dialogueCards: currentParsedList.value,
    });
  } catch (e) {
    console.error("保存草稿失败", e);
  }
};

onMounted(() => {
  loadProjects();
});

const selectProject = async (name) => {
  // 切换前尝试立即保存上一个
  if (currentProject.value) {
    await saveDraft();
  }

  currentProject.value = name;
  // 切新项目清空
  currentParsedList.value = [];
  globalChars.value = {};
  currentNovelText.value = "";

  try {
    const charRes = await axios.get(`http://localhost:3000/api/projects/${name}/characters`);
    if (charRes.data.success) {
      globalChars.value = charRes.data.characters;
    }

    const draftRes = await axios.get(`http://localhost:3000/api/projects/${name}/draft`);
    if (draftRes.data.success && draftRes.data.draft) {
      currentNovelText.value = draftRes.data.draft.novelText || "";
      currentParsedList.value = draftRes.data.draft.dialogueCards || [];
    }
  } catch (e) {
    console.error("拉取项目现有配置失败", e);
  }
};

const handleCreateProject = async () => {
  const val = newProjectName.value.trim();
  if (!val) return ElMessage.warning("请输入项目名称");

  isCreating.value = true;
  try {
    const res = await axios.post("http://localhost:3000/api/projects", { projectName: val });
    if (res.data.success) {
      ElMessage.success("项目创建成功");
      newProjectName.value = "";
      await loadProjects();
      selectProject(val); // 自动进入
    }
  } catch (e) {
    ElMessage.error(e.response?.data?.error || "创建项目失败");
  } finally {
    isCreating.value = false;
  }
};

const handleDeleteProject = async (name) => {
  try {
    await ElMessageBox.confirm(`确定要删除项目 "${name}" 及所有关联数据吗？此操作不可恢复！`, "警告", {
      confirmButtonText: "确定删除",
      cancelButtonText: "取消",
      type: "warning",
    });

    const res = await axios.delete(`http://localhost:3000/api/projects/${name}`);
    if (res.data.success) {
      ElMessage.success("删除成功");
      if (currentProject.value === name) {
        currentProject.value = null;
      }
      loadProjects();
    }
  } catch (e) {
    if (e !== "cancel") {
      ElMessage.error("删除项目失败");
    }
  }
};

// 接收左侧组件的解析结果
const handleParsedData = (dataList, characters) => {
  currentParsedList.value = dataList;
  globalChars.value = characters;
  saveDraft();
};

const handleTextChanged = (newText) => {
  currentNovelText.value = newText;
};

const handleCardsChanged = (newCards) => {
  currentParsedList.value = newCards;
};
</script>

<style>
body,
html {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
</style>
