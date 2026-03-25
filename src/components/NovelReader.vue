<template>
  <div class="h-full w-full flex flex-col bg-[#0f0f1a] text-[#e2e2f0] font-sans overflow-hidden">

    <!-- ===================== 搜索视图 ===================== -->
    <div v-if="viewState === 'search'" class="flex-1 overflow-y-auto pb-10 custom-scrollbar">
      <!-- 顶部品牌区 -->
      <div class="flex flex-col items-center px-6 pt-14 pb-9 bg-[radial-gradient(ellipse_at_top,_#1a1a3e_0%,_#0f0f1a_60%)]">
        <div class="text-[52px] mb-3">📖</div>
        <h2 class="text-[32px] font-bold bg-gradient-to-br from-[#a09ef5] to-[#e087ff] bg-clip-text text-transparent m-0 mb-2">书海漫游</h2>
        <p class="text-[#7777aa] text-[15px] m-0 mb-8">搜索你想阅读的小说，开启沉浸阅读旅程</p>

        <!-- 搜索框 -->
        <div class="flex w-full max-w-[560px] gap-2.5">
          <input
            v-model="searchKeyword"
            class="flex-1 px-5 py-3.5 bg-[#1a1a2e] border border-[#3a3a6a] rounded-xl text-[#e2e2f0] text-base outline-none transition-all duration-200 focus:border-[#7c6ff7] focus:ring-[3px] focus:ring-[rgba(124,111,247,0.2)] placeholder:text-[#555577]"
            placeholder="输入书名或作者..."
            @keyup.enter="doSearch"
          />
          <button class="px-6 py-3.5 bg-gradient-to-br from-[#7c6ff7] to-[#c44dff] rounded-xl text-white text-[15px] font-semibold flex items-center gap-1.5 whitespace-nowrap transition-all duration-200 hover:-translate-y-[1px] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none" :disabled="isSearching" @click="doSearch">
            <span v-if="isSearching" class="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
            <span v-else>🔍 搜索</span>
          </button>
        </div>
      </div>

      <!-- 搜索结果 -->
      <div v-if="searchResults.length" class="px-6">
        <div class="py-4 pb-3">
          <span class="text-[#8888bb] text-sm">找到 {{ searchResults.length }} 部作品</span>
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          <div
            v-for="(book, i) in searchResults"
            :key="i"
            class="flex gap-3.5 bg-[#15152a] border border-[#2a2a4a] rounded-2xl p-3.5 cursor-pointer transition-all duration-250 hover:border-[#7c6ff7] hover:-translate-y-0.5 hover:shadow-[0_6px_24px_rgba(124,111,247,0.18)]"
            @click="selectBook(book)"
          >
            <div class="shrink-0 w-[68px] h-[90px] rounded-lg overflow-hidden bg-[#1e1e3a]">
              <img v-if="book.coverUrl" class="w-full h-full object-cover" :src="book.coverUrl" :alt="book.name" @error="handleImgError($event)" />
              <div v-else class="w-full h-full flex items-center justify-center text-[28px] font-bold bg-gradient-to-br from-[#2e2e5a] to-[#3a2a5a] text-[#a09ef5]">{{ book.name?.slice(0, 1) }}</div>
            </div>
            <div class="flex-1 min-w-0 flex flex-col gap-1">
              <div class="text-[15px] font-semibold text-[#ddddf5] whitespace-nowrap overflow-hidden text-ellipsis" :title="book.name">{{ book.name }}</div>
              <div class="text-[13px] text-[#8888bb]">{{ book.author }}</div>
              <div class="text-xs text-[#666699] line-clamp-2 overflow-hidden flex-1 leading-relaxed" :title="book.intro">{{ book.intro }}</div>
              <div class="flex flex-wrap gap-1.5 mt-1">
                <span class="text-[11px] px-2 py-0.5 bg-[rgba(124,111,247,0.15)] border border-[rgba(124,111,247,0.3)] rounded-full text-[#a09ef5]">{{ book.originName }}</span>
                <span v-if="book.latestChapterTitle" class="text-[11px] text-[#555577] whitespace-nowrap overflow-hidden text-ellipsis max-w-[160px]">最新：{{ book.latestChapterTitle }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 搜索为空提示 -->
      <div v-else-if="hasSearched && !isSearching" class="flex flex-col items-center justify-center py-20 px-5 text-[#666699] gap-3">
        <div class="text-5xl">🔎</div>
        <p>未找到相关作品，换个关键词试试？</p>
      </div>
    </div>

    <!-- ===================== 章节列表视图 ===================== -->
    <div v-else-if="viewState === 'chapters'" class="flex-1 flex flex-col overflow-hidden">
      <!-- 顶部导航 -->
      <div class="flex items-center gap-4 px-5 py-3.5 bg-[#12122a] border-b border-[#2a2a4a] shrink-0">
        <button class="bg-[rgba(124,111,247,0.15)] border border-[rgba(124,111,247,0.3)] text-[#a09ef5] px-4 py-2 rounded-lg cursor-pointer text-sm transition-colors duration-200 hover:bg-[rgba(124,111,247,0.28)] whitespace-nowrap" @click="viewState = 'search'">← 返回搜索</button>
        <div class="flex items-center gap-2.5 flex-1 min-w-0">
          <span class="font-semibold text-base text-[#ddddf5] whitespace-nowrap overflow-hidden text-ellipsis">{{ selectedBook?.name }}</span>
          <span class="text-[13px] text-[#8888bb] whitespace-nowrap">{{ selectedBook?.author }}</span>
          <span class="text-[11px] px-2 py-0.5 bg-[rgba(196,77,255,0.15)] border border-[rgba(196,77,255,0.3)] rounded-full text-[#d088ff] whitespace-nowrap">{{ selectedBook?.originName }}</span>
        </div>
      </div>

      <!-- 章节加载中 -->
      <div v-if="isLoadingChapters" class="flex flex-col items-center justify-center py-[60px] px-5 gap-4 text-[#8888bb]">
        <div class="w-9 h-9 border-4 border-[#2a2a4a] border-t-[#7c6ff7] rounded-full animate-spin"></div>
        <p>正在获取章节列表...</p>
      </div>

      <!-- 章节列表 -->
      <div v-else-if="chapterList.length" class="flex-1 overflow-y-auto p-4 px-5 custom-scrollbar">
        <div class="text-[#6666aa] text-[13px] mb-3">共 {{ chapterList.length }} 章</div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
          <div
            v-for="(chap, idx) in chapterList"
            :key="idx"
            class="px-3.5 py-2.5 bg-[#15152a] border border-[#2a2a4a] rounded-lg text-[13px] text-[#c0c0e0] cursor-pointer transition-colors duration-200 whitespace-nowrap overflow-hidden text-ellipsis"
            :class="chap.isVolume ? 'bg-[rgba(196,77,255,0.08)] border-[rgba(196,77,255,0.25)] text-[#c44dff] pointer-events-none font-semibold' : 'hover:bg-[rgba(124,111,247,0.15)] hover:border-[#7c6ff7] hover:text-[#e0e0ff]'"
            @click="selectChapter(chap, idx)"
          >
            {{ chap.title }}
          </div>
        </div>
      </div>

      <div v-else class="flex flex-col items-center justify-center py-20 px-5 text-[#666699] gap-3">
        <div class="text-5xl">📋</div>
        <p>暂无章节数据</p>
      </div>
    </div>

    <!-- ===================== 阅读视图 ===================== -->
    <div v-else-if="viewState === 'reading'" class="flex-1 flex flex-col overflow-hidden">
      <!-- 顶部导航 -->
      <div class="flex items-center gap-3.5 px-5 py-3 bg-[rgba(18,18,42,0.95)] border-b border-[#2a2a4a] shrink-0 backdrop-blur-md">
        <button class="bg-[rgba(124,111,247,0.15)] border border-[rgba(124,111,247,0.3)] text-[#a09ef5] px-4 py-2 rounded-lg cursor-pointer text-sm transition-colors duration-200 hover:bg-[rgba(124,111,247,0.28)] whitespace-nowrap" @click="viewState = 'chapters'">← 章节列表</button>
        <div class="flex-1 text-center text-[15px] font-semibold text-[#c0c0e0] whitespace-nowrap overflow-hidden text-ellipsis">{{ selectedChapter?.title }}</div>
        <div class="flex gap-2 items-center">
          <!-- 听书控制区 -->
          <div class="flex items-center gap-2">
            <!-- idle: 显示听书按钮 -->
            <button
              v-if="listenState === 'idle'"
              class="px-3.5 py-1.5 bg-gradient-to-br from-[#7c6ff7] to-[#c44dff] rounded-lg text-white text-[13px] font-semibold cursor-pointer transition-all duration-200 hover:opacity-90 hover:-translate-y-[1px] whitespace-nowrap"
              @click="startListening"
            >🎧 听书</button>

            <!-- loading: 转圈 + 阶段文字 -->
            <div v-else-if="listenState === 'loading'" class="flex items-center gap-2 px-3 py-1.5 bg-[rgba(124,111,247,0.12)] border border-[rgba(124,111,247,0.3)] rounded-lg">
              <span class="inline-block w-3.5 h-3.5 border-2 border-[#7c6ff7]/40 border-t-[#7c6ff7] rounded-full animate-spin"></span>
              <span class="text-[12px] text-[#a09ef5] whitespace-nowrap">{{ listenPhaseText }}</span>
            </div>

            <!-- ready: 播放/暂停控制 -->
            <div v-else-if="listenState === 'ready'" class="flex items-center gap-2">
              <button
                class="px-3.5 py-1.5 bg-[rgba(124,111,247,0.15)] border border-[rgba(124,111,247,0.3)] rounded-lg text-[#a09ef5] text-[13px] cursor-pointer transition-all duration-200 hover:bg-[rgba(124,111,247,0.28)] whitespace-nowrap"
                @click="togglePlayPause"
              >{{ isPlaying ? '⏸ 暂停' : '▶ 播放' }}</button>
              <span class="text-[11px] text-[#6666aa] whitespace-nowrap">{{ currentSegIdx + 1 }} / {{ segments.length }}</span>
            </div>

            <!-- error: 重试 -->
            <button
              v-else-if="listenState === 'error'"
              class="px-3.5 py-1.5 bg-[rgba(255,80,80,0.12)] border border-[rgba(255,80,80,0.3)] rounded-lg text-[#ff8080] text-[13px] cursor-pointer whitespace-nowrap hover:bg-[rgba(255,80,80,0.22)]"
              @click="startListening"
            >⚠ 重试</button>
          </div>

          <button class="px-3.5 py-1.5 bg-[rgba(124,111,247,0.1)] border border-[rgba(124,111,247,0.25)] rounded-lg text-[#a09ef5] text-[13px] cursor-pointer transition-colors duration-200 whitespace-nowrap hover:bg-[rgba(124,111,247,0.25)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[rgba(124,111,247,0.1)]" :disabled="currentChapterIndex <= 0" @click="goPrevChapter">‹ 上一章</button>
          <button class="px-3.5 py-1.5 bg-[rgba(124,111,247,0.1)] border border-[rgba(124,111,247,0.25)] rounded-lg text-[#a09ef5] text-[13px] cursor-pointer transition-colors duration-200 whitespace-nowrap hover:bg-[rgba(124,111,247,0.25)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[rgba(124,111,247,0.1)]" :disabled="currentChapterIndex >= chapterList.length - 1" @click="goNextChapter">下一章 ›</button>
        </div>
      </div>

      <!-- 正文内容 -->
      <div class="flex-1 overflow-y-auto bg-[#0f0f1a] custom-scrollbar" ref="readingBody">
        <div v-if="isLoadingContent" class="flex flex-col items-center justify-center py-[60px] px-5 gap-4 text-[#8888bb]">
          <div class="w-9 h-9 border-4 border-[#2a2a4a] border-t-[#7c6ff7] rounded-full animate-spin"></div>
          <p>正在加载内容...</p>
        </div>

        <div v-else class="max-w-[760px] mx-auto pt-9 pb-20 px-7">
          <h2 class="text-[22px] font-bold text-[#e0e0ff] m-0 mb-9 text-center pb-5 border-b border-[#2a2a4a]">{{ selectedChapter?.title }}</h2>

          <!-- 听书模式：渲染 segments（支持高亮） -->
          <template v-if="listenState === 'ready' || listenState === 'loading'">
            <div
              v-for="(seg, i) in segments"
              :key="i"
              :ref="el => { if (el) segRefs[i] = el }"
              class="mb-4 rounded-lg px-3 py-1 transition-all duration-300"
              :class="[
                seg.type === 'narration'
                  ? 'text-[17px] leading-loose text-[#c8c8e8] indent-8 tracking-wide break-all italic'
                  : 'text-[17px] leading-loose text-[#dde0ff] tracking-wide break-all',
                i === currentSegIdx
                  ? 'bg-[rgba(124,111,247,0.18)] border-l-[3px] border-[#7c6ff7] pl-4 indent-0'
                  : ''
              ]"
            >
              <span v-if="seg.type === 'dialogue'" class="text-[12px] text-[#8866cc] mr-1.5 font-semibold not-italic">{{ seg.role }}：</span>
              {{ seg.text }}
            </div>
            <!-- 生成中占位提示 -->
            <div v-if="listenState === 'loading'" class="flex items-center gap-2 text-[#555577] text-sm py-4">
              <span class="inline-block w-3.5 h-3.5 border-2 border-[#555577]/40 border-t-[#555577] rounded-full animate-spin"></span>
              <span>正在生成后续音频，可以开始阅读…</span>
            </div>
          </template>

          <!-- 普通阅读模式：渲染原始段落 -->
          <template v-else>
            <div
              v-for="(para, i) in contentParagraphs"
              :key="i"
              class="text-[17px] leading-loose text-[#c8c8e8] mb-4 indent-8 tracking-wide break-all"
            >{{ para }}</div>
          </template>
        </div>
      </div>

      <!-- 底部操作 -->
      <div class="flex items-center justify-between px-6 py-3.5 bg-[rgba(12,12,28,0.98)] border-t border-[#2a2a4a] shrink-0">
        <button class="px-7 py-2.5 bg-[rgba(124,111,247,0.12)] border border-[rgba(124,111,247,0.3)] rounded-xl text-[#a09ef5] text-[15px] cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:bg-[rgba(124,111,247,0.28)] disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none" :disabled="currentChapterIndex <= 0" @click="goPrevChapter">‹ 上一章</button>
        <span class="text-[#6666aa] text-[14px]">{{ currentChapterIndex + 1 }} / {{ chapterList.length }}</span>
        <button class="px-7 py-2.5 bg-[rgba(124,111,247,0.12)] border border-[rgba(124,111,247,0.3)] rounded-xl text-[#a09ef5] text-[15px] cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:bg-[rgba(124,111,247,0.28)] disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none" :disabled="currentChapterIndex >= chapterList.length - 1" @click="goNextChapter">下一章 ›</button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import axios from 'axios'

const API = 'http://localhost:3000'

// ── 状态机 ──
const viewState = ref('search') // 'search' | 'chapters' | 'reading'

// ── 搜索 ──
const searchKeyword = ref('')
const isSearching    = ref(false)
const hasSearched    = ref(false)
const searchResults  = ref([])

const doSearch = async () => {
  const key = searchKeyword.value.trim()
  if (!key) return
  isSearching.value  = true
  hasSearched.value  = false
  searchResults.value = []
  try {
    const res = await axios.get(`${API}/api/reader/searchBookMultiSSE`, {
      params: { key, concurrentCount: 4 }
    })
    searchResults.value = res.data.data || []
  } catch (e) {
    console.error('搜索失败', e)
    searchResults.value = []
  } finally {
    isSearching.value = false
    hasSearched.value = true
  }
}

// ── 选书 → 章节 ──
const selectedBook      = ref(null)
const chapterList       = ref([])
const isLoadingChapters = ref(false)

const selectBook = async (book) => {
  selectedBook.value = book
  viewState.value    = 'chapters'
  chapterList.value  = []
  isLoadingChapters.value = true
  try {
    const res = await axios.get(`${API}/api/reader/getChapterList`, {
      params: { url: book.bookUrl, bookSourceUrl: book.origin }
    })
    if (res.data.isSuccess) {
      chapterList.value = res.data.data || []
    }
  } catch (e) {
    console.error('获取章节列表失败', e)
  } finally {
    isLoadingChapters.value = false
  }
}

// ── 选章 → 阅读 ──
const selectedChapter    = ref(null)
const currentChapterIndex = ref(0)
const contentParagraphs  = ref([])
const isLoadingContent   = ref(false)
const readingBody        = ref(null)

const selectChapter = async (chap, idx) => {
  resetListen()
  selectedChapter.value    = chap
  currentChapterIndex.value = idx
  viewState.value          = 'reading'
  await fetchContent(chap, idx)
  // 进入阅读视图后自动检查是否已有听书缓存
  await checkListenCache()
}

const fetchContent = async (chap, idx) => {
  contentParagraphs.value = []
  isLoadingContent.value  = true
  await nextTick()
  if (readingBody.value) readingBody.value.scrollTop = 0
  try {
    const res = await axios.get(`${API}/api/reader/getBookContent`, {
      params: { url: chap.bookUrl, index: idx }
    })
    if (res.data.isSuccess) {
      contentParagraphs.value = (res.data.data || '')
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0)
    }
  } catch (e) {
    console.error('获取正文失败', e)
  } finally {
    isLoadingContent.value = false
  }
}

// 上 / 下章
const goPrevChapter = () => {
  const idx = currentChapterIndex.value - 1
  if (idx < 0) return
  selectChapter(chapterList.value[idx], idx)
}
const goNextChapter = () => {
  const idx = currentChapterIndex.value + 1
  if (idx >= chapterList.value.length) return
  selectChapter(chapterList.value[idx], idx)
}

// 图片加载失败回退
const handleImgError = (e) => {
  e.target.style.display = 'none'
  e.target.nextElementSibling && (e.target.nextElementSibling.style.display = 'flex')
}

// ════════════════════════════════════════════════════════════
// 听书功能
// ════════════════════════════════════════════════════════════

// 项目名以书名命名（避免与手动项目冲突）
const listenProjectName = computed(() => `reader_${selectedBook.value?.name || 'unknown'}`)

// 状态
const listenState   = ref('idle')   // idle | loading | ready | error
const listenPhase   = ref('')       // prescan | parse | assign | tts | done
const segments      = ref([])       // { index, type, role, emotion, text, audioUrl }
const currentSegIdx = ref(-1)       // 当前播放的 segment 索引
const isPlaying     = ref(false)
const segRefs       = ref([])       // DOM 引用，用于自动滚动
const listenTaskId = ref(null)
// 轮询定时器
let pollTimer = null
// 当前播放的 Audio 对象
let currentAudio = null
// 是否强制停止（切章、重置时）
let forceStop = false
// 当前章节的 TTS 生成是否已全部完成
const isGenerationComplete = ref(false)

// 阶段文案
const phaseTextMap = {
  waiting:  '准备中…',
  prescan:  '正在预扫描章节角色…',
  parse:    '正在分析剧情对话…',
  assign:   '正在分配参考音频…',
  tts:      '正在生成语音…',
  done:     '',
}
const listenPhaseText = computed(() => phaseTextMap[listenPhase.value] || '处理中…')

// ── 重置听书状态（并发通知后端取消任务）──
function resetListen(skipCancel = false) {
  forceStop = true
  stopPolling()
  if (currentAudio) { currentAudio.pause(); currentAudio = null }
  forceStop = false
  // 通知后端取消正在进行中的任务
  if (!skipCancel && listenTaskId.value) {
    axios.post(`${API}/api/listen-book/cancel/${listenTaskId.value}`).catch(() => {})
  }
  listenTaskId.value        = null
  listenState.value         = 'idle'
  listenPhase.value         = ''
  segments.value            = []
  currentSegIdx.value       = -1
  isPlaying.value           = false
  segRefs.value             = []
  isGenerationComplete.value = false
}

// ── 检查缓存（进入阅读视图时自动调用）──
async function checkListenCache() {
  try {
    const res = await axios.post(`${API}/api/listen-book/check`, {
      projectName: listenProjectName.value,
      chapterIndex: currentChapterIndex.value,
    })
    if (res.data.exists) {
      segments.value = res.data.segments || []
      isGenerationComplete.value = true
      listenState.value = 'ready'
      await nextTick()
      triggerPrefetch()
    } else if (res.data.inProgress && res.data.taskId) {
      listenTaskId.value = res.data.taskId
      listenState.value = 'loading'
      startPolling(res.data.taskId)
    }
  } catch (e) {
    console.warn('检查听书缓存失败', e.message)
  }
}

// ── 点击「听书」启动 ──
async function startListening() {
  listenState.value = 'loading'
  listenPhase.value = 'waiting'

  try {
    const res = await axios.post(`${API}/api/listen-book/generate`, {
      projectName: listenProjectName.value,
      chapterIndex: currentChapterIndex.value,
      chapterUrl: selectedChapter.value.bookUrl,
      chapterList: chapterList.value,
    })

    if (res.data.alreadyDone) {
      listenTaskId.value = res.data.taskId || null
      segments.value = res.data.segments || []
      isGenerationComplete.value = true
      listenState.value = 'ready'
      autoPlay()
      triggerPrefetch()
      return
    }

    listenTaskId.value = res.data.taskId
    startPolling(res.data.taskId)
  } catch (e) {
    console.error('启动听书失败', e)
    listenState.value = 'error'
  }
}

// ── 轮询任务状态 ──
// PLAY_THRESHOLD：至少生成多少段才开始播放
const PLAY_THRESHOLD = 5

function startPolling(taskId) {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const res = await axios.get(`${API}/api/listen-book/status/${taskId}`)
      const { phase, segments: segs, error } = res.data

      listenPhase.value = phase

      // 实时同步 segments（追加方式，避免覆盖正在播放的引用）
      if (Array.isArray(segs) && segs.length > segments.value.length) {
        segments.value = segs
      }

      // 达到阈值且当前还在 loading 状态 → 立即开始播放
      if (
        listenState.value === 'loading' &&
        segments.value.length >= PLAY_THRESHOLD
      ) {
        listenState.value = 'ready'
        autoPlay()  // 从头开始顺序播放；playFrom 的 for 循环随 segments.value 增长自动延伸
      }

      if (phase === 'done') {
        stopPolling()
        // 确保最终 segments 完整
        if (Array.isArray(segs)) segments.value = segs
        // 标记生成完毕，playFrom 的等待循环会感知并退出
        isGenerationComplete.value = true
        // 如果还没开始播（段数不足5就生成完了），现在进 ready
        if (listenState.value === 'loading') {
          listenState.value = 'ready'
          autoPlay()
        }
        // done 后才触发后续章节预缓存
        triggerPrefetch()
      } else if (phase === 'error') {
        stopPolling()
        listenState.value = 'error'
        console.error('听书生成失败：', error)
      }
    } catch (e) {
      console.warn('轮询失败', e.message)
    }
  }, 2000)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// ── 自动播放（进入 ready 状态后从头开始）──
function autoPlay() {
  currentSegIdx.value = -1
  isPlaying.value = true
  playFrom(0)
}

// ── 暂停 / 继续 ──
function togglePlayPause() {
  if (isPlaying.value) {
    // 暂停
    isPlaying.value = false
    if (currentAudio) { currentAudio.pause() }
  } else {
    // 继续
    isPlaying.value = true
    if (currentAudio) {
      currentAudio.play()
    } else {
      // 从当前位置重新开始
      const startIdx = currentSegIdx.value >= 0 ? currentSegIdx.value : 0
      playFrom(startIdx)
    }
  }
}

// ── 顺序播放 segments（从指定索引开始，支持等待后续生成的内容）──
async function playFrom(startIndex) {
  let i = startIndex
  while (true) {
    if (forceStop || !isPlaying.value) break

    if (i >= segments.value.length) {
      // 当前已有 segments 播完，判断是否还有后续生成中
      if (isGenerationComplete.value) break  // 生成已全部完成，真正结束
      // 还在生成中，等待 500ms 后再检查是否有新 segment 到来
      await new Promise(r => setTimeout(r, 500))
      continue
    }

    const seg = segments.value[i]
    currentSegIdx.value = i
    scrollToSeg(i)

    if (seg.audioUrl) {
      await playAudioUrl(seg.audioUrl)
    }

    if (!isPlaying.value) break
    i++
  }

  // 播放自然结束
  if (isPlaying.value) {
    isPlaying.value = false
    currentAudio = null
  }
}

// ── 播放单条音频，返回 Promise（播放完毕 resolve）──
function playAudioUrl(url) {
  return new Promise((resolve) => {
    if (forceStop) { resolve(); return }
    const audio = new Audio(`${API}${url}`)
    currentAudio = audio
    audio.onended = () => { currentAudio = null; resolve() }
    audio.onerror = () => { currentAudio = null; resolve() } // 出错也继续
    audio.play().catch(() => resolve())
  })
}

// ── 自动滚动到当前高亮段落 ──
function scrollToSeg(idx) {
  nextTick(() => {
    const el = segRefs.value[idx]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
}

// ── 后台预生成后续章节（fire-and-forget）──
async function triggerPrefetch() {
  try {
    const configRes = await axios.get(`${API}/api/listen-book/config`)
    const prefetchCount = configRes.data.prefetchCount || 2

    for (let i = 1; i <= prefetchCount; i++) {
      const nextIdx = currentChapterIndex.value + i
      if (nextIdx >= chapterList.value.length) break
      const nextChap = chapterList.value[nextIdx]
      // 静默触发，不 await，不报错阻塞
      axios.post(`${API}/api/listen-book/generate`, {
        projectName: listenProjectName.value,
        chapterIndex: nextIdx,
        chapterUrl: nextChap.bookUrl,
        chapterList: chapterList.value,
      }).catch(() => {})
    }
  } catch {
    // 预生成失败不影响主流程
  }
}

// 组件卸载时清理并取消后台任务
onBeforeUnmount(() => {
  resetListen()
})
</script>

<style scoped>
/* 滚动条美化 */
.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #2a2a4a;
  border-radius: 4px;
}
</style>
