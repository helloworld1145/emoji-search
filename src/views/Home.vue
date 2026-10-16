<script setup lang="ts">
import { computed, inject, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { RefreshCw, ChevronRight, Share2, FolderOpen, Eye, FolderPlus, Trash2, CheckSquare, Sparkles, Trash, PictureInPicture2, Search as SearchIcon, X, Clock, MessageCircle, MessagesSquare } from 'lucide-vue-next'
import { useEmojiStore } from '../stores/emoji'
import { useCollectionStore } from '../stores/collection'
import { useTrashStore } from '../stores/trash'
import EmojiGrid from '../components/EmojiGrid.vue'
import ScanProgress from '../components/ScanProgress.vue'
import EmptyState from '../components/EmptyState.vue'
import BaseSheet from '../components/BaseSheet.vue'
import CollectionPicker from '../components/CollectionPicker.vue'
import { pushBackHandler } from '../services/backHandler'
import { PULL_REFRESH_KEY } from '../services/pullRefresh'
import { FloatingWindow } from '../services/nativeBridge'
import * as emojiRepo from '../db/repositories/emoji'
import * as collectionRepo from '../db/repositories/collection'
import * as searchRepo from '../db/repositories/search'
import { initDatabase } from '../db/database'
import { isFuzzyKeyword } from '../utils/confusable'
import type { EmojiRecord, SavedFolder } from '../types'

const router = useRouter()
const emojiStore = useEmojiStore()
const collectionStore = useCollectionStore()
const trashStore = useTrashStore()

/** 待确认删除的表情 id 列表（长按单条 / 多选批量共用） */
const pendingDeleteIds = ref<string[]>([])
const deleteConfirmOpen = computed(() => pendingDeleteIds.value.length > 0)

/** 长按操作面板 */
const actionItem = ref<EmojiRecord | null>(null)
const pickerOpen = ref(false)
const toast = ref('')
/** 文件夹管理弹层与正在扫描的文件夹标识 */
const foldersOpen = ref(false)
const scanningFolderUri = ref<string | null>(null)

/** 悬浮窗快速发送开关状态（原生悬浮窗是否在运行） */
const floatingRunning = ref(false)

/** 多选批量删除 */
const selecting = ref(false)
const selectedIds = ref<string[]>([])

/** 批量加入收藏夹弹层 */
const addToCollectionOpen = ref(false)

/* ===================== 内嵌搜索（原 Search 页合并而来） ===================== */
const keyword = ref('')
const results = ref<EmojiRecord[]>([])
const searching = ref(false)
const searched = ref(false)
const history = ref<string[]>([])
let debounceTimer: number | null = null

const hasQuery = computed(() => keyword.value.trim().length > 0)
/** 当前关键词是否触发了形近/同音近似匹配（用于结果区提示） */
const fuzzyActive = computed(() => isFuzzyKeyword(keyword.value.trim()))

function onKeywordInput() {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => runSearch(), 300)
}

/** 当前选中的收藏夹（筛选态）名称，仅用于结果区提示 */
const filterCollectionName = computed(
  () =>
    homeCollections.value.find((c) => c.id === emojiStore.filterCollectionId)?.name ??
    ''
)

async function runSearch() {
  if (!hasQuery.value) {
    results.value = []
    searched.value = false
    return
  }
  searching.value = true
  try {
    const kw = keyword.value.trim()
    // 选中收藏夹时：仅做文字/标签匹配，再按「该收藏夹成员」前端过滤取交集；
    // 不再合并「收藏夹名命中」（避免混入其他收藏夹、保证纯交集）。
    // 采用前端过滤而非 SQL JOIN，以兼容真机原生 SQLite 的差异。
    const collectionId = emojiStore.filterCollectionId
    if (collectionId) {
      const textHits = await emojiRepo.search({ keyword: kw, limit: 240 })
      let list = textHits
      try {
        const items = await collectionRepo.getCollectionItems(collectionId, 10000)
        const idSet = new Set(items.map((i) => i.id))
        list = textHits.filter((r) => idSet.has(r.id))
      } catch (e) {
        // 取收藏夹成员失败则降级为全局文字结果，不阻塞主流程
        console.error('filter by collection failed', e)
      }
      results.value = list
      searched.value = true
      return
    }
    // 未选中收藏夹：保留原行为（文字/标签命中 + 收藏夹名命中合并）
    const textHits = await emojiRepo.search({ keyword: kw, limit: 120 })
    const merged: EmojiRecord[] = [...textHits]
    const seen = new Set(textHits.map((r) => r.id))
    try {
      const collectionHits = await collectionRepo.searchEmojisByCollectionName(kw, 120)
      for (const item of collectionHits) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        merged.push(item)
        if (merged.length >= 240) break
      }
    } catch (e) {
      // 收藏夹查询失败降级为仅文字结果，不阻塞主流程
      console.error('search collections failed', e)
    }
    results.value = merged
    searched.value = true
  } catch (e) {
    console.error('search failed', e)
  } finally {
    searching.value = false
  }
}

/** 切换收藏夹筛选：搜索态下重跑搜索以实时刷新交集（非搜索态由 setCollectionFilter 刷新网格） */
function onToggleCollectionFilter(id: string | null) {
  // 不 await：filterCollectionId 在 setCollectionFilter 内已同步设置，
  // 立即重跑可避免其内部后续 await 异常中断刷新
  void emojiStore.setCollectionFilter(id)
  if (searched.value && hasQuery.value) void runSearch()
}

async function onHistoryClick(kw: string) {
  keyword.value = kw
  await runSearch()
}

async function onSearchSubmit() {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  if (keyword.value.trim()) {
    await searchRepo.addSearchHistory(keyword.value.trim())
    history.value = await searchRepo.getRecentSearches()
  }
  await runSearch()
}

function clearKeyword() {
  keyword.value = ''
  results.value = []
  searched.value = false
}

async function clearHistory() {
  await searchRepo.clearSearchHistory()
  history.value = []
}

const scanning = computed(() =>
  ['scanning', 'recognizing'].includes(emojiStore.scanState.phase)
)

/** 展示全部收藏夹（含默认「我的收藏」总收藏） */
const homeCollections = computed(() => collectionStore.collections)

onMounted(async () => {
  await initDatabase()
  await emojiStore.init()
  await collectionStore.loadCollections()
  await trashStore.refreshCount()
  await refreshFloatingState()
  history.value = await searchRepo.getRecentSearches()
})

/**
 * 同步悬浮窗开关的真实运行态。
 *
 * 原生侧 start() 只保证「服务已投递」，服务内部若挂不上悬浮球会自行 stopSelf，
 * 故回到首页时重新读取，避免开关显示「关闭」但实际没有悬浮球。
 */
async function refreshFloatingState() {
  try {
    const { running } = await FloatingWindow.isRunning()
    floatingRunning.value = running
  } catch {
    /* Web 或无原生环境忽略 */
  }
}

/**
 * 下拉刷新回调：从数据库重新拉取当前筛选下的表情网格，并刷新总数与待识别计数。
 * 复用 store 现有能力（loadGrid 重置分页重查、refreshCounts 按收藏夹筛选刷新），
 * 不涉及文件夹扫描。仅在首页被 keep-alive 激活时注册，切走时注销避免误触发。
 */
const pullRefresh = inject(PULL_REFRESH_KEY)
onActivated(async () => {
  // keep-alive 下首页不重新 onMounted：从通知栏/服务关掉悬浮球后返回 App 时，
  // 顺带同步一次真实运行状态，保证顶栏图标与面板开关不失真
  await refreshFloatingState()
  // 重查收藏夹计数与封面：详情页加星 / 加入收藏夹、收藏夹详情移出、回收站恢复等
  // 二级页操作都会改变「我的收藏」等收藏夹数量，仅靠各页 store 内的 refreshCount
  // 无法覆盖全部返回路径（如星标收藏只走 emoji store），故每次回到首页轻量重查一次。
  // 与 Collections / CollectionDetail 的 onActivated 模式一致；只重查收藏夹，
  // 不重查网格、不清滚动位置，避免首页回到顶部
  await collectionStore.loadCollections()
  pullRefresh?.setHandler(async () => {
    await emojiStore.refreshCounts()
    await emojiStore.loadGrid(true)
  })
  // 搜索态下从详情页返回时重跑搜索，剔除期间被软删的表情（与原 Search 行为一致）
  if (searched.value && hasQuery.value) void runSearch()
})
onDeactivated(() => {
  pullRefresh?.setHandler(null)
})

function onItemClick(item: EmojiRecord) {
  router.push(`/emoji/${item.id}`)
}

function onLongPress(item: EmojiRecord) {
  if (selecting.value) return
  actionItem.value = item
}

function onViewDetail() {
  const item = actionItem.value
  actionItem.value = null
  if (item) router.push(`/emoji/${item.id}`)
}

function onOpenPicker() {
  pickerOpen.value = true
}

async function onPicked(collectionId: string) {
  const item = actionItem.value
  pickerOpen.value = false
  actionItem.value = null
  if (!item) return
  await collectionStore.addEmoji(collectionId, item.id)
  toast.value = '已加入收藏夹'
  setTimeout(() => (toast.value = ''), 1600)
}

const shareMenuOpen = ref(false)
const sharePath = ref('')

/** 打开分享菜单（从长按面板接力，保存路径后关闭面板） */
function openShareMenu() {
  const item = actionItem.value
  if (!item) return
  sharePath.value = item.path
  actionItem.value = null
  shareMenuOpen.value = true
}

/** 选择具体分享目标：微信 / QQ / 系统分享（更多） */
async function onShareTarget(target: 'wechat' | 'qq' | 'system') {
  const p = sharePath.value
  shareMenuOpen.value = false
  sharePath.value = ''
  if (!p) return
  const ok = await emojiStore.share(p, target, (m) => {
    toast.value = m
    setTimeout(() => (toast.value = ''), 1600)
  })
  if (!ok) {
    toast.value = '分享失败，请重试'
    setTimeout(() => (toast.value = ''), 1600)
  }
}

/** 长按面板：发起单条删除确认 */
function onAskDelete() {
  const item = actionItem.value
  actionItem.value = null
  if (item) pendingDeleteIds.value = [item.id]
}

/** 多选模式：发起批量删除确认 */
function onAskDeleteSelected() {
  if (selectedIds.value.length === 0) return
  pendingDeleteIds.value = [...selectedIds.value]
}

function cancelDelete() {
  pendingDeleteIds.value = []
}

/** 确认删除：软删除（移入回收站，不删手机源文件），并刷新列表与统计 */
async function confirmDelete() {
  const ids = [...pendingDeleteIds.value]
  pendingDeleteIds.value = []
  if (ids.length === 0) return
  try {
    await trashStore.moveToTrash(ids)
    clearSelection()
    // 缓存首页：即时从网格剔除已删表情，保留其余项与滚动位置
    emojiStore.removeFromGrid(ids)
    await emojiStore.refreshCounts()
    // 搜索结果独立于 emojiStore.items：搜索态下需重跑以剔除已删表情
    if (searched.value && hasQuery.value) await runSearch()
    toast.value = `已移入回收站：${ids.length} 张`
    setTimeout(() => (toast.value = ''), 1600)
  } catch (e) {
    console.error('moveToTrash failed', e)
    toast.value = '删除失败，请重试'
    setTimeout(() => (toast.value = ''), 1600)
  }
}

function openTrash() {
  router.push('/trash')
}

/** 收藏夹管理列表页（改由底部导航「收藏夹」进入） */
function openFavorites() {
  router.push('/collections')
}

/** 收藏夹详情二级页入口（保留复用，首页 chip 不再调用） */
function openCollection(id: string) {
  router.push(`/collection/${id}`)
}

/** 打开文件夹管理面板（已选文件夹列表 + 添加/扫描/移除） */
function openFolders() {
  foldersOpen.value = true
}

/** 切换悬浮窗快速发送：运行中→关闭；未运行→启动（无悬浮窗权限则引导去系统设置页） */
async function toggleFloating() {
  try {
    if (floatingRunning.value) {
      await FloatingWindow.stop()
      floatingRunning.value = false
      toast.value = '悬浮窗已关闭'
    } else {
      await FloatingWindow.start()
      floatingRunning.value = true
      toast.value = '悬浮窗已开启，去微信/QQ 长按粘贴试试'
    }
    setTimeout(() => (toast.value = ''), 1600)
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e)
    if (msg.includes('NO_OVERLAY_PERMISSION')) {
      toast.value = '请先授予「显示在其他应用上」权限'
      setTimeout(() => (toast.value = ''), 1800)
      await FloatingWindow.openSettings()
    } else {
      toast.value = '开启失败，请重试'
      setTimeout(() => (toast.value = ''), 1600)
    }
  }
}

/** 面板内「添加文件夹」：仅加入列表，扫描由用户按需触发 */
async function onAddFolder() {
  const f = await emojiStore.addFolder()
  if (f) {
    toast.value = `已添加：${f.name}`
    setTimeout(() => (toast.value = ''), 1600)
  }
}

/** 扫描某个已选文件夹 */
async function onScanFolder(folder: SavedFolder) {
  if (scanning.value) return
  scanningFolderUri.value = folder.treeUri
  await emojiStore.startFolderScan(folder)
  await collectionStore.loadCollections()
  scanningFolderUri.value = null
}

/** 移除某个已选文件夹（仅删授权记录） */
async function onRemoveFolder(treeUri: string) {
  await emojiStore.removeFolder(treeUri)
}

/** 重新识别历史失败（退出识别队列）的表情 */
async function onReRecognize() {
  if (scanning.value) return
  const count = await emojiStore.reRecognizeFailed()
  await collectionStore.loadCollections()
  toast.value = count > 0 ? `重新识别完成：${count} 张` : '没有需要重新识别的表情'
  setTimeout(() => (toast.value = ''), 1600)
}

/** 进入/退出多选模式 */
function toggleSelectMode() {
  selecting.value = !selecting.value
  selectedIds.value = []
}

function onToggleSelect(item: EmojiRecord) {
  const idx = selectedIds.value.indexOf(item.id)
  if (idx >= 0) selectedIds.value.splice(idx, 1)
  else selectedIds.value.push(item.id)
}

const allSelected = computed(
  () => emojiStore.items.length > 0 && selectedIds.value.length === emojiStore.items.length,
)

function toggleSelectAll() {
  if (allSelected.value) {
    selectedIds.value = []
  } else {
    selectedIds.value = emojiStore.items.map((e) => e.id)
  }
}

function clearSelection() {
  selecting.value = false
  selectedIds.value = []
}

/** 批量加入收藏夹：将当前选中表情全部加入所选收藏夹（含默认总收藏同步、计数刷新） */
async function onPickedCollection(collectionId: string) {
  addToCollectionOpen.value = false
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  try {
    for (const id of ids) {
      await collectionStore.addEmoji(collectionId, id)
    }
    await collectionStore.loadCollections()
    toast.value = `已加入 ${ids.length} 张表情`
    setTimeout(() => (toast.value = ''), 1600)
  } catch (e) {
    console.error('批量加入收藏夹失败', e)
    toast.value = '加入失败，请重试'
    setTimeout(() => (toast.value = ''), 1600)
  }
}

/** 多选模式打开时，系统返回键 = 退出多选，而非回退页面 */
let unregisterSelectBack: (() => void) | null = null
watch(selecting, (on) => {
  unregisterSelectBack?.()
  unregisterSelectBack = on
    ? pushBackHandler(() => {
        clearSelection()
        return true
      })
    : null
})
onUnmounted(() => unregisterSelectBack?.())
</script>

<template>
  <div class="page pt-[calc(8px+env(safe-area-inset-top))]">
    <!-- 顶部标题栏 -->
    <header class="sticky top-0 z-20 bg-surface/90 backdrop-blur-md px-4 pt-2 pb-3">
      <div class="flex items-end justify-between">
        <div>
          <h1 class="text-[22px] font-semibold leading-tight">表情包</h1>
          <p class="text-xs text-ink-muted mt-0.5">
            共 {{ emojiStore.total }} 张
            <span v-if="emojiStore.pendingCount > 0" class="text-ink-faint">
              · {{ emojiStore.pendingCount }} 张待识别
            </span>
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn btn-ghost h-9 w-9 !p-0 relative cursor-pointer"
            aria-label="回收站"
            @click="openTrash"
          >
            <Trash :size="16" />
          </button>
          <button
            type="button"
            class="btn btn-ghost h-9 w-9 !p-0 cursor-pointer"
            :class="floatingRunning ? 'text-primary' : 'text-ink-muted'"
            aria-label="悬浮窗快速发送"
            @click="toggleFloating"
          >
            <PictureInPicture2 :size="16" />
          </button>
          <button
            type="button"
            class="btn btn-ghost h-9 px-3.5 text-xs cursor-pointer"
            @click="openFolders"
          >
            <FolderOpen :size="14" />
            选择文件夹
          </button>
        </div>
      </div>
    </header>

    <ScanProgress :state="emojiStore.scanState" />

    <!-- 收藏夹快捷入口 -->
    <section v-if="homeCollections.length > 0" class="px-4 mb-3">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-sm font-medium">收藏夹</h2>
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="flex items-center text-xs cursor-pointer"
            :class="selecting ? 'text-primary' : 'text-ink-muted hover:text-ink'"
            @click="toggleSelectMode"
          >
            <CheckSquare :size="13" />
            选择
          </button>
          <button
            v-if="emojiStore.filterCollectionId"
            type="button"
            class="flex items-center text-xs text-primary cursor-pointer hover:opacity-80"
            @click="onToggleCollectionFilter(null)"
          >
            显示全部
            <ChevronRight :size="13" />
          </button>
        </div>
      </div>
      <!-- 横向滚动容器：py-1.5 而非仅 pb-1，因 overflow-x-auto 会连带把 overflow-y 计算为 auto
           而裁切 box-shadow，纵向留白避免选中态 ring / shadow-card 被上方「收藏夹」标题压住 -->
      <div class="flex gap-2 overflow-x-auto py-1.5 -mx-1 px-1">
        <button
          v-for="col in homeCollections"
          :key="col.id"
          type="button"
          class="chip shrink-0 bg-card shadow-card cursor-pointer"
          :class="
            /* 非选中态刻意不加 hover 变体：触屏 tap 后 :hover 会粘滞不释放，
               导致再次点击取消筛选后文字仍是红色；@media(hover:hover) 也挡不住
               （部分 Android WebView 会把 hover:hover 报告为真） */
            emojiStore.filterCollectionId === col.id
              ? 'text-primary ring-1 ring-primary'
              : 'text-ink'
          "
          @click="onToggleCollectionFilter(col.id)"
        >
          {{ col.name }}
          <span class="text-ink-faint">{{ col.count }}</span>
        </button>
      </div>
    </section>

    <!-- 搜索框（多选模式时隐藏，避免与批量操作栏冲突） -->
    <section v-if="!selecting" class="px-4 mb-3">
      <form class="flex gap-2" @submit.prevent="onSearchSubmit">
        <div class="flex-1 flex items-center gap-2 h-11 rounded-xl bg-card shadow-card px-3">
          <SearchIcon :size="16" class="text-ink-faint shrink-0" />
          <input
            v-model="keyword"
            type="text"
            placeholder="搜索表情包上的文字或收藏夹名称"
            class="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-ink-faint"
            @input="onKeywordInput"
          />
          <button
            v-if="keyword"
            type="button"
            class="text-ink-faint hover:text-ink cursor-pointer shrink-0"
            aria-label="清空"
            @click="clearKeyword"
          >
            <X :size="15" />
          </button>
        </div>
        <button type="submit" class="btn btn-primary h-11 px-4 text-sm cursor-pointer shrink-0">
          搜索
        </button>
      </form>

      <!-- 搜索历史（仅在未发起搜索时展示，搜索后让位给结果区） -->
      <template v-if="!searched">
        <div v-if="history.length > 0" class="mt-3">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-1.5 text-sm font-medium">
              <Clock :size="15" class="text-ink-faint" />
              最近搜索
            </div>
            <button
              type="button"
              class="flex items-center gap-1 text-xs text-ink-faint cursor-pointer hover:text-danger"
              @click="clearHistory"
            >
              <Trash2 :size="13" />
              清空
            </button>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="kw in history"
              :key="kw"
              type="button"
              class="chip bg-card text-ink shadow-card cursor-pointer hover:text-primary"
              @click="onHistoryClick(kw)"
            >
              {{ kw }}
            </button>
          </div>
        </div>
      </template>
    </section>

    <!-- 多选批量操作栏 -->
    <div
      v-if="selecting"
      class="sticky top-[57px] z-10 mx-4 mb-3 card p-2.5 flex items-center gap-2"
    >
      <span class="text-xs text-ink-muted px-1">已选 {{ selectedIds.length }}</span>
      <button type="button" class="btn btn-ghost h-8 px-3 text-xs cursor-pointer" @click="toggleSelectAll">
        {{ allSelected ? '取消全选' : '全选' }}
      </button>
      <div class="flex-1" />
      <button
        type="button"
        class="btn btn-ghost h-8 px-3 text-xs cursor-pointer"
        :disabled="selectedIds.length === 0"
        @click="addToCollectionOpen = true"
      >
        <FolderPlus :size="13" />
        加入收藏夹
      </button>
      <button
        type="button"
        class="btn btn-ghost h-8 px-3 text-xs cursor-pointer hover:text-danger"
        :disabled="selectedIds.length === 0"
        @click="onAskDeleteSelected"
      >
        <Trash2 :size="13" />
        删除
      </button>
    </div>

    <!-- 内容区：搜索结果 or 全部表情（多选模式下始终显示全部网格） -->
    <section class="px-4">
      <!-- 搜索中 -->
      <div v-if="!selecting && searching" class="py-10 text-center text-xs text-ink-faint">搜索中…</div>

      <!-- 搜索结果（有搜索词且非多选时） -->
      <template v-else-if="!selecting && searched && hasQuery">
        <div class="flex items-center flex-wrap gap-2 mb-2">
          <p class="text-xs text-ink-muted">
            <template v-if="filterCollectionName">在收藏夹「{{ filterCollectionName }}」中搜索：</template>
            找到 {{ results.length }} 个结果
          </p>
          <span
            v-if="fuzzyActive"
            class="chip bg-primary/10 text-primary text-[11px] leading-none px-2 py-1"
            title="已对形近字、同音字做容错，错别字也能搜到"
          >近似匹配已开启</span>
        </div>
        <EmojiGrid
          v-if="results.length > 0"
          :items="results"
          :finished="true"
          @click="onItemClick"
          @longpress="onLongPress"
        />
        <EmptyState
          v-else
          icon="🔍"
          title="没有找到相关表情"
          description="试试其他关键词，也可能是还没有扫描识别"
        />
      </template>

      <!-- 全部表情网格（含多选态） -->
      <template v-else>
        <EmojiGrid
          v-if="emojiStore.items.length > 0"
          :items="emojiStore.items"
          :loading="emojiStore.gridLoading"
          :finished="emojiStore.gridFinished"
          :selectable="selecting"
          :selected-ids="selectedIds"
          @load-more="emojiStore.loadGrid()"
          @click="onItemClick"
          @longpress="onLongPress"
          @toggle-select="onToggleSelect"
        />
        <EmptyState
          v-else-if="!scanning"
          icon="🗂️"
          title="还没有扫描到表情包"
          description="点击「选择文件夹」手动挑选表情包所在目录，添加后即可扫描识别"
          action-text="选择文件夹"
          @action="openFolders"
        />
      </template>
    </section>

    <!-- 长按操作面板 -->
    <BaseSheet
      :visible="actionItem !== null"
      title="表情操作"
      @close="actionItem = null"
    >
      <div class="space-y-1 pb-2">
        <button
          type="button"
          class="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-black/5 cursor-pointer text-left"
          @click="onViewDetail"
        >
          <Eye :size="18" class="text-ink-muted" />
          <span class="text-sm">查看详情</span>
        </button>
        <button
          type="button"
          class="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-black/5 cursor-pointer text-left"
          @click="onOpenPicker"
        >
          <FolderOpen :size="18" class="text-ink-muted" />
          <span class="text-sm">加入收藏夹</span>
        </button>
        <button
          type="button"
          class="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-black/5 cursor-pointer text-left"
          @click="openShareMenu"
        >
          <Share2 :size="18" class="text-ink-muted" />
          <span class="text-sm">分享到…</span>
        </button>
        <button
          type="button"
          class="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-black/5 cursor-pointer text-left"
          @click="onAskDelete"
        >
          <Trash2 :size="18" class="text-danger" />
          <span class="text-sm text-danger">删除</span>
        </button>
      </div>
    </BaseSheet>

    <!-- 分享选择 -->
    <BaseSheet :visible="shareMenuOpen" title="分享到" @close="shareMenuOpen = false">
      <div class="grid grid-cols-3 gap-3 py-2">
        <button
          type="button"
          class="flex flex-col items-center gap-2 cursor-pointer group"
          @click="onShareTarget('wechat')"
        >
          <span
            class="w-14 h-14 rounded-full bg-[#07C160] text-white flex items-center justify-center shadow-float transition-transform group-hover:scale-105 group-active:scale-95"
          >
            <MessageCircle :size="24" />
          </span>
          <span class="text-xs text-ink-muted">微信</span>
        </button>
        <button
          type="button"
          class="flex flex-col items-center gap-2 cursor-pointer group"
          @click="onShareTarget('qq')"
        >
          <span
            class="w-14 h-14 rounded-full bg-[#12B7F5] text-white flex items-center justify-center shadow-float transition-transform group-hover:scale-105 group-active:scale-95"
          >
            <MessagesSquare :size="24" />
          </span>
          <span class="text-xs text-ink-muted">QQ</span>
        </button>
        <button
          type="button"
          class="flex flex-col items-center gap-2 cursor-pointer group"
          @click="onShareTarget('system')"
        >
          <span
            class="w-14 h-14 rounded-full bg-black/10 text-ink-muted flex items-center justify-center shadow-float transition-transform group-hover:scale-105 group-active:scale-95"
          >
            <Share2 :size="24" />
          </span>
          <span class="text-xs text-ink-muted">系统分享</span>
        </button>
      </div>
      <button
        type="button"
        class="btn btn-ghost w-full h-11 text-sm cursor-pointer mt-1"
        @click="shareMenuOpen = false"
      >
        取消
      </button>
    </BaseSheet>

    <!-- 收藏夹选择器 -->
    <BaseSheet :visible="pickerOpen" title="加入收藏夹" @close="pickerOpen = false">
      <CollectionPicker :emoji-id="actionItem?.id ?? ''" @picked="onPicked" />
    </BaseSheet>

    <!-- 批量加入收藏夹 -->
    <BaseSheet :visible="addToCollectionOpen" title="加入收藏夹" @close="addToCollectionOpen = false">
      <CollectionPicker emoji-id="" @picked="onPickedCollection" />
    </BaseSheet>

    <!-- 文件夹管理面板 -->
    <BaseSheet :visible="foldersOpen" title="我的文件夹" @close="foldersOpen = false">
      <div class="px-1 pb-2">
        <div
          v-if="emojiStore.savedFolders.length === 0"
          class="text-center text-xs text-ink-muted py-8"
        >
          还没有手动添加的文件夹，点击下方「添加文件夹」开始挑选
        </div>
        <ul v-else class="space-y-1">
          <li
            v-for="folder in emojiStore.savedFolders"
            :key="folder.treeUri"
            class="flex items-center gap-3 p-3 rounded-xl hover:bg-black/5"
          >
            <FolderOpen :size="18" class="text-primary shrink-0" />
            <span class="flex-1 min-w-0 text-sm truncate">{{ folder.name }}</span>
            <button
              type="button"
              class="flex items-center gap-1 text-xs text-ink-muted cursor-pointer hover:text-primary disabled:opacity-50"
              :disabled="scanning"
              @click="onScanFolder(folder)"
            >
              <RefreshCw :size="13" :class="{ 'animate-spin': scanningFolderUri === folder.treeUri }" />
              扫描
            </button>
            <button
              type="button"
              class="text-xs text-danger cursor-pointer hover:opacity-80"
              @click="onRemoveFolder(folder.treeUri)"
            >
              移除
            </button>
          </li>
        </ul>
        <!-- 悬浮窗快速发送开关（常驻悬浮球，聊天时直接分享表情） -->
        <div class="flex items-center gap-3 p-3 rounded-xl bg-black/5 mt-2">
          <div class="flex-1 min-w-0">
            <div class="text-sm">悬浮窗快速发送</div>
            <div class="text-xs text-ink-muted mt-0.5 leading-snug">
              开启后屏幕边缘出现悬浮球，聊天时点开即可分享表情到微信 / QQ，无需来回切换 App
            </div>
          </div>
          <button
            type="button"
            class="btn h-9 px-3.5 text-xs shrink-0 cursor-pointer"
            :class="floatingRunning ? 'bg-danger text-white' : 'btn-primary'"
            @click="toggleFloating"
          >
            {{ floatingRunning ? '关闭' : '开启' }}
          </button>
        </div>
        <button
          type="button"
          class="btn w-full h-11 mt-3 text-sm cursor-pointer bg-black/5 hover:bg-black/10"
          :class="{ 'opacity-50': scanning }"
          :disabled="scanning"
          @click="onReRecognize"
        >
          <Sparkles :size="16" />
          重新识别失败表情
        </button>
        <button
          type="button"
          class="btn btn-primary w-full h-11 mt-3 text-sm cursor-pointer"
          :class="{ 'opacity-50': scanning }"
          :disabled="scanning"
          @click="onAddFolder"
        >
          <FolderPlus :size="16" />
          添加文件夹
        </button>
      </div>
    </BaseSheet>

    <!-- 删除确认（软删除：移入回收站，不删手机源文件） -->
    <BaseSheet
      :visible="deleteConfirmOpen"
      title="删除表情"
      @close="cancelDelete"
    >
      <p class="text-sm text-ink-muted py-2">
        确定删除选中的 {{ pendingDeleteIds.length }} 张表情吗？删除后仅不在本 App
        内显示，不会删除手机里的原图，可到「回收站」中恢复。
      </p>
      <div class="flex gap-2 pt-2 pb-2">
        <button
          type="button"
          class="btn btn-ghost flex-1 h-11 text-sm cursor-pointer"
          @click="cancelDelete"
        >
          取消
        </button>
        <button
          type="button"
          class="btn flex-1 h-11 text-sm cursor-pointer bg-danger text-white"
          @click="confirmDelete"
        >
          移入回收站
        </button>
      </div>
    </BaseSheet>

    <!-- 轻提示 -->
    <transition name="toast">
      <div
        v-if="toast"
        class="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 px-4 py-2 rounded-full bg-ink text-white text-xs shadow-float"
      >
        {{ toast }}
      </div>
    </transition>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
