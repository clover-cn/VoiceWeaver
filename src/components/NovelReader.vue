<template>
  <div class="novel-reader">

    <!-- ===================== 搜索视图 ===================== -->
    <div v-if="viewState === 'search'" class="view-search">
      <!-- 顶部品牌区 -->
      <div class="search-hero">
        <div class="hero-icon">📖</div>
        <h2 class="hero-title">书海漫游</h2>
        <p class="hero-sub">搜索你想阅读的小说，开启沉浸阅读旅程</p>

        <!-- 搜索框 -->
        <div class="search-bar">
          <input
            v-model="searchKeyword"
            class="search-input"
            placeholder="输入书名或作者..."
            @keyup.enter="doSearch"
          />
          <button class="search-btn" :disabled="isSearching" @click="doSearch">
            <span v-if="isSearching" class="spinner"></span>
            <span v-else>🔍 搜索</span>
          </button>
        </div>
      </div>

      <!-- 搜索结果 -->
      <div v-if="searchResults.length" class="results-section">
        <div class="results-header">
          <span class="results-count">找到 {{ searchResults.length }} 部作品</span>
        </div>
        <div class="books-grid">
          <div
            v-for="(book, i) in searchResults"
            :key="i"
            class="book-card"
            @click="selectBook(book)"
          >
            <div class="book-cover">
              <img v-if="book.coverUrl" :src="book.coverUrl" :alt="book.name" @error="handleImgError($event)" />
              <div v-else class="cover-placeholder">{{ book.name?.slice(0, 1) }}</div>
            </div>
            <div class="book-info">
              <div class="book-name" :title="book.name">{{ book.name }}</div>
              <div class="book-author">{{ book.author }}</div>
              <div class="book-intro" :title="book.intro">{{ book.intro }}</div>
              <div class="book-meta">
                <span class="origin-tag">{{ book.originName }}</span>
                <span v-if="book.latestChapterTitle" class="latest-chap">最新：{{ book.latestChapterTitle }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 搜索为空提示 -->
      <div v-else-if="hasSearched && !isSearching" class="empty-state">
        <div class="empty-icon">🔎</div>
        <p>未找到相关作品，换个关键词试试？</p>
      </div>
    </div>

    <!-- ===================== 章节列表视图 ===================== -->
    <div v-else-if="viewState === 'chapters'" class="view-chapters">
      <!-- 顶部导航 -->
      <div class="sub-nav">
        <button class="back-btn" @click="viewState = 'search'">← 返回搜索</button>
        <div class="current-book-info">
          <span class="current-book-name">{{ selectedBook?.name }}</span>
          <span class="current-book-author">{{ selectedBook?.author }}</span>
          <span class="origin-badge">{{ selectedBook?.originName }}</span>
        </div>
      </div>

      <!-- 章节加载中 -->
      <div v-if="isLoadingChapters" class="loading-box">
        <div class="loading-ring"></div>
        <p>正在获取章节列表...</p>
      </div>

      <!-- 章节列表 -->
      <div v-else-if="chapterList.length" class="chapters-container">
        <div class="chapters-header">共 {{ chapterList.length }} 章</div>
        <div class="chapters-grid">
          <div
            v-for="(chap, idx) in chapterList"
            :key="idx"
            class="chapter-item"
            :class="{ 'is-volume': chap.isVolume }"
            @click="selectChapter(chap, idx)"
          >
            {{ chap.title }}
          </div>
        </div>
      </div>

      <div v-else class="empty-state">
        <div class="empty-icon">📋</div>
        <p>暂无章节数据</p>
      </div>
    </div>

    <!-- ===================== 阅读视图 ===================== -->
    <div v-else-if="viewState === 'reading'" class="view-reading">
      <!-- 顶部导航 -->
      <div class="read-nav">
        <button class="back-btn" @click="viewState = 'chapters'">← 章节列表</button>
        <div class="read-nav-title">{{ selectedChapter?.title }}</div>
        <div class="read-nav-right">
          <button class="nav-chap-btn" :disabled="currentChapterIndex <= 0" @click="goPrevChapter">‹ 上一章</button>
          <button class="nav-chap-btn" :disabled="currentChapterIndex >= chapterList.length - 1" @click="goNextChapter">下一章 ›</button>
        </div>
      </div>

      <!-- 正文内容 -->
      <div class="reading-body" ref="readingBody">
        <div v-if="isLoadingContent" class="loading-box">
          <div class="loading-ring"></div>
          <p>正在加载内容...</p>
        </div>
        <div v-else class="content-wrapper">
          <h2 class="chapter-title">{{ selectedChapter?.title }}</h2>
          <div
            v-for="(para, i) in contentParagraphs"
            :key="i"
            class="paragraph"
          >{{ para }}</div>
        </div>
      </div>

      <!-- 底部操作 -->
      <div class="read-footer">
        <button class="footer-btn" :disabled="currentChapterIndex <= 0" @click="goPrevChapter">‹ 上一章</button>
        <span class="footer-info">{{ currentChapterIndex + 1 }} / {{ chapterList.length }}</span>
        <button class="footer-btn" :disabled="currentChapterIndex >= chapterList.length - 1" @click="goNextChapter">下一章 ›</button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import axios from 'axios'

// ---- 状态机 ----
const viewState = ref('search') // 'search' | 'chapters' | 'reading'

// ---- 搜索 ----
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
    const res = await axios.get('http://localhost:3000/api/reader/searchBookMultiSSE', {
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

// ---- 选书 → 章节 ----
const selectedBook      = ref(null)
const chapterList       = ref([])
const isLoadingChapters = ref(false)

const selectBook = async (book) => {
  selectedBook.value = book
  viewState.value    = 'chapters'
  chapterList.value  = []
  isLoadingChapters.value = true
  try {
    const res = await axios.get('http://localhost:3000/api/reader/getChapterList', {
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

// ---- 选章 → 阅读 ----
const selectedChapter    = ref(null)
const currentChapterIndex = ref(0)
const contentParagraphs  = ref([])
const isLoadingContent   = ref(false)
const readingBody        = ref(null)

const selectChapter = async (chap, idx) => {
  selectedChapter.value    = chap
  currentChapterIndex.value = idx
  viewState.value          = 'reading'
  await fetchContent(chap, idx)
}

const fetchContent = async (chap, idx) => {
  contentParagraphs.value = []
  isLoadingContent.value  = true
  // 滚动回顶部
  await nextTick()
  if (readingBody.value) readingBody.value.scrollTop = 0
  try {
    const res = await axios.get('http://localhost:3000/api/reader/getBookContent', {
      params: { url: chap.bookUrl, index: idx }
    })
    if (res.data.isSuccess) {
      // 将正文按 \n 拆段，过滤空白行
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
</script>

<style scoped>
/* === 全局容器 === */
.novel-reader {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  background: #0f0f1a;
  color: #e2e2f0;
  font-family: 'Inter', 'Source Han Serif CN', 'Noto Serif SC', serif;
  overflow: hidden;
}

/* === 通用：加载框 === */
.loading-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 16px;
  color: #8888bb;
}
.loading-ring {
  width: 36px;
  height: 36px;
  border: 3px solid #2a2a4a;
  border-top-color: #7c6ff7;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* === 通用：空状态 === */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  color: #666699;
  gap: 12px;
}
.empty-icon { font-size: 48px; }

/* === 通用：返回按钮 === */
.back-btn {
  background: rgba(124,111,247,0.15);
  border: 1px solid rgba(124,111,247,0.3);
  color: #a09ef5;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
  white-space: nowrap;
}
.back-btn:hover { background: rgba(124,111,247,0.28); }

/* ===================== 搜索视图 ===================== */
.view-search {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 40px;
}

/* 英雄区 */
.search-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 56px 24px 36px;
  background: radial-gradient(ellipse at top, #1a1a3e 0%, #0f0f1a 60%);
}
.hero-icon { font-size: 52px; margin-bottom: 12px; }
.hero-title {
  font-size: 32px;
  font-weight: 700;
  background: linear-gradient(135deg, #a09ef5, #e087ff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0 0 8px;
}
.hero-sub { color: #7777aa; font-size: 15px; margin: 0 0 32px; }

/* 搜索框 */
.search-bar {
  display: flex;
  width: 100%;
  max-width: 560px;
  gap: 10px;
}
.search-input {
  flex: 1;
  padding: 14px 20px;
  background: #1a1a2e;
  border: 1px solid #3a3a6a;
  border-radius: 12px;
  color: #e2e2f0;
  font-size: 16px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.search-input:focus {
  border-color: #7c6ff7;
  box-shadow: 0 0 0 3px rgba(124,111,247,0.2);
}
.search-input::placeholder { color: #555577; }
.search-btn {
  padding: 14px 24px;
  background: linear-gradient(135deg, #7c6ff7, #c44dff);
  border: none;
  border-radius: 12px;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.search-btn:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
.search-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

/* 结果区 */
.results-section { padding: 0 24px; }
.results-header { padding: 16px 0 12px; }
.results-count { color: #8888bb; font-size: 14px; }

.books-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
.book-card {
  display: flex;
  gap: 14px;
  background: #15152a;
  border: 1px solid #2a2a4a;
  border-radius: 14px;
  padding: 14px;
  cursor: pointer;
  transition: border-color 0.25s, transform 0.2s, box-shadow 0.25s;
}
.book-card:hover {
  border-color: #7c6ff7;
  transform: translateY(-2px);
  box-shadow: 0 6px 24px rgba(124,111,247,0.18);
}
.book-cover {
  flex-shrink: 0;
  width: 68px;
  height: 90px;
  border-radius: 8px;
  overflow: hidden;
  background: #1e1e3a;
}
.book-cover img { width: 100%; height: 100%; object-fit: cover; }
.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  font-weight: 700;
  background: linear-gradient(135deg, #2e2e5a, #3a2a5a);
  color: #a09ef5;
}
.book-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.book-name {
  font-size: 15px;
  font-weight: 600;
  color: #ddddf5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.book-author { font-size: 13px; color: #8888bb; }
.book-intro {
  font-size: 12px;
  color: #666699;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
  line-height: 1.5;
}
.book-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.origin-tag {
  font-size: 11px;
  padding: 2px 8px;
  background: rgba(124,111,247,0.15);
  border: 1px solid rgba(124,111,247,0.3);
  border-radius: 20px;
  color: #a09ef5;
}
.latest-chap {
  font-size: 11px;
  color: #555577;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}

/* ===================== 章节列表视图 ===================== */
.view-chapters {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sub-nav {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 20px;
  background: #12122a;
  border-bottom: 1px solid #2a2a4a;
  flex-shrink: 0;
}
.current-book-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.current-book-name {
  font-weight: 600;
  font-size: 16px;
  color: #ddddf5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.current-book-author { font-size: 13px; color: #8888bb; white-space: nowrap; }
.origin-badge {
  font-size: 11px;
  padding: 2px 8px;
  background: rgba(196,77,255,0.15);
  border: 1px solid rgba(196,77,255,0.3);
  border-radius: 20px;
  color: #d088ff;
  white-space: nowrap;
}

.chapters-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}
.chapters-header {
  color: #6666aa;
  font-size: 13px;
  margin-bottom: 12px;
}
.chapters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}
.chapter-item {
  padding: 10px 14px;
  background: #15152a;
  border: 1px solid #2a2a4a;
  border-radius: 8px;
  font-size: 13px;
  color: #c0c0e0;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chapter-item:hover {
  background: rgba(124,111,247,0.15);
  border-color: #7c6ff7;
  color: #e0e0ff;
}
.chapter-item.is-volume {
  background: rgba(196,77,255,0.08);
  border-color: rgba(196,77,255,0.25);
  color: #c44dff;
  pointer-events: none;
  font-weight: 600;
}

/* ===================== 阅读视图 ===================== */
.view-reading {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.read-nav {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 20px;
  background: rgba(18,18,42,0.95);
  border-bottom: 1px solid #2a2a4a;
  flex-shrink: 0;
  backdrop-filter: blur(8px);
}
.read-nav-title {
  flex: 1;
  text-align: center;
  font-size: 15px;
  font-weight: 600;
  color: #c0c0e0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.read-nav-right { display: flex; gap: 8px; }
.nav-chap-btn {
  padding: 6px 14px;
  background: rgba(124,111,247,0.1);
  border: 1px solid rgba(124,111,247,0.25);
  border-radius: 8px;
  color: #a09ef5;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}
.nav-chap-btn:hover:not(:disabled) { background: rgba(124,111,247,0.25); }
.nav-chap-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.reading-body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
  background: #0f0f1a;
}
.content-wrapper {
  max-width: 760px;
  margin: 0 auto;
  padding: 36px 28px 80px;
}
.chapter-title {
  font-size: 22px;
  font-weight: 700;
  color: #e0e0ff;
  margin: 0 0 36px;
  text-align: center;
  padding-bottom: 20px;
  border-bottom: 1px solid #2a2a4a;
}
.paragraph {
  font-size: 17px;
  line-height: 2;
  color: #c8c8e8;
  margin-bottom: 18px;
  text-indent: 2em;
  letter-spacing: 0.02em;
  word-break: break-all;
}

/* 底栏 */
.read-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  background: rgba(12,12,28,0.98);
  border-top: 1px solid #2a2a4a;
  flex-shrink: 0;
}
.footer-btn {
  padding: 10px 28px;
  background: rgba(124,111,247,0.12);
  border: 1px solid rgba(124,111,247,0.3);
  border-radius: 10px;
  color: #a09ef5;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
}
.footer-btn:hover:not(:disabled) {
  background: rgba(124,111,247,0.28);
  transform: translateY(-1px);
}
.footer-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.footer-info { color: #6666aa; font-size: 14px; }

/* 滚动条美化 */
.view-search::-webkit-scrollbar,
.chapters-container::-webkit-scrollbar,
.reading-body::-webkit-scrollbar { width: 6px; }
.view-search::-webkit-scrollbar-track,
.chapters-container::-webkit-scrollbar-track,
.reading-body::-webkit-scrollbar-track { background: transparent; }
.view-search::-webkit-scrollbar-thumb,
.chapters-container::-webkit-scrollbar-thumb,
.reading-body::-webkit-scrollbar-thumb {
  background: #2a2a4a;
  border-radius: 4px;
}
</style>
