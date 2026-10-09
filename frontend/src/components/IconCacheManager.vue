<script setup lang="ts">
/**
 * 设置面板 →「图标缓存」分类。
 *
 * 参考 sun-panel 的 UploadFileManager 范式：棋盘格透明底 + 响应式卡片网格
 * + 每卡操作按钮 + 信息弹窗；样式沿用 FlatNas 的 Tailwind 风格（不引 Naive UI）。
 *
 * 数据来自 4 个新增接口：
 *   GET    /api/icon-cache/list
 *   DELETE /api/icon-cache/:name[?force=1]
 *   POST   /api/icon-cache/batch-delete
 *   POST   /api/icon-cache/cleanup
 */
import { computed, onMounted, ref } from "vue";
import { useMainStore } from "../stores/main";
import OverlayMotion from "@/components/base/OverlayMotion.vue";
import {
  ICON_CACHE_ACCEPT,
  filterIconFiles,
  formatBytes,
  parseIconCacheError,
  parseIconCacheList,
  readFileAsDataUrl,
  sortIconFiles,
  summarizeIconFiles,
  type IconCacheFile,
  type IconCacheSortMode,
} from "@/utils/iconCache";

const store = useMainStore();

const loading = ref(false);
const errorMessage = ref("");
const files = ref<IconCacheFile[]>([]);
const keyword = ref("");
const sortMode = ref<IconCacheSortMode>("newest");
const onlyUnused = ref(false);
const selectedNames = ref<string[]>([]);
const busy = ref(false);
const uploading = ref(false);
const uploadInput = ref<HTMLInputElement | null>(null);

/** 棋盘格透明底（sun-panel 最有辨识度的那处，用来衬托透明 PNG/SVG） */
const checkerboardStyle: Record<string, string> = {
  backgroundColor: "#ffffff",
  backgroundImage: [
    "linear-gradient(45deg, #eef2f7 25%, transparent 25%)",
    "linear-gradient(-45deg, #eef2f7 25%, transparent 25%)",
    "linear-gradient(45deg, transparent 75%, #eef2f7 75%)",
    "linear-gradient(-45deg, transparent 75%, #eef2f7 75%)",
  ].join(", "),
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
};

const summary = computed(() => summarizeIconFiles(files.value));
const visibleFiles = computed(() => {
  let list = filterIconFiles(files.value, keyword.value);
  if (onlyUnused.value) list = list.filter((file) => file.refCount <= 0);
  return sortIconFiles(list, sortMode.value);
});
const visibleNames = computed(() => visibleFiles.value.map((file) => file.name));
const allVisibleSelected = computed(
  () =>
    visibleNames.value.length > 0 &&
    visibleNames.value.every((name) => selectedNames.value.includes(name)),
);
const selectedFiles = computed(() =>
  files.value.filter((file) => selectedNames.value.includes(file.name)),
);
const selectedInUseCount = computed(
  () => selectedFiles.value.filter((file) => file.refCount > 0).length,
);
const unreferencedCount = computed(
  () => files.value.filter((file) => file.refCount <= 0).length,
);
const unreferencedSize = computed(() =>
  files.value.filter((file) => file.refCount <= 0).reduce((sum, f) => sum + (f.size || 0), 0),
);

// ---- 提示 / 确认 / 信息弹窗 ----
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const showToast = (message: string) => {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), 2600);
};

const showConfirm = ref(false);
const confirmTitle = ref("");
const confirmMessage = ref("");
const confirmDanger = ref(true);
let confirmAction: () => void = () => {};
const askConfirm = (opts: {
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: () => void;
}) => {
  confirmTitle.value = opts.title;
  confirmMessage.value = opts.message;
  confirmDanger.value = opts.danger ?? true;
  confirmAction = opts.onConfirm;
  showConfirm.value = true;
};
const closeConfirm = () => {
  showConfirm.value = false;
};
const runConfirm = () => {
  const action = confirmAction;
  closeConfirm();
  action();
};

const infoFile = ref<IconCacheFile | null>(null);
const showInfo = ref(false);
const openInfo = (file: IconCacheFile) => {
  infoFile.value = file;
  showInfo.value = true;
};

// ---- 数据 ----
const fetchList = async () => {
  loading.value = true;
  errorMessage.value = "";
  try {
    const res = await fetch("/api/icon-cache/list", { headers: store.getHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      errorMessage.value = parseIconCacheError(data, res.status).message;
      return;
    }
    const parsed = parseIconCacheList(data);
    files.value = parsed.files;
    // 丢弃已经不存在于列表里的勾选
    const alive = new Set(parsed.files.map((f) => f.name));
    selectedNames.value = selectedNames.value.filter((name) => alive.has(name));
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : "加载失败，请稍后重试";
  } finally {
    loading.value = false;
  }
};

const isSelected = (name: string) => selectedNames.value.includes(name);
const toggleSelect = (name: string) => {
  selectedNames.value = isSelected(name)
    ? selectedNames.value.filter((item) => item !== name)
    : [...selectedNames.value, name];
};
const toggleSelectAllVisible = () => {
  if (allVisibleSelected.value) {
    const drop = new Set(visibleNames.value);
    selectedNames.value = selectedNames.value.filter((name) => !drop.has(name));
    return;
  }
  const merged = new Set([...selectedNames.value, ...visibleNames.value]);
  selectedNames.value = [...merged];
};
const clearSelection = () => {
  selectedNames.value = [];
};

// ---- 删除 ----
const deleteOne = async (file: IconCacheFile, force: boolean) => {
  busy.value = true;
  try {
    const url = `/api/icon-cache/${encodeURIComponent(file.name)}${force ? "?force=1" : ""}`;
    const res = await fetch(url, { method: "DELETE", headers: store.getHeaders() });
    if (res.ok) {
      showToast(`已删除 ${file.name}`);
      store.refreshResources();
      await fetchList();
      return;
    }
    const data = await res.json().catch(() => null);
    const info = parseIconCacheError(data, res.status);
    if (res.status === 409 && !force) {
      askConfirm({
        title: "该图标正在使用中",
        message: `「${file.name}」正被 ${info.refCount || file.refCount} 张卡片使用，删除后这些卡片会缺图。仍要删除吗？`,
        onConfirm: () => void deleteOne(file, true),
      });
      return;
    }
    showToast(info.message);
  } catch (e) {
    showToast(e instanceof Error ? e.message : "删除失败");
  } finally {
    busy.value = false;
  }
};

const requestDelete = (file: IconCacheFile) => {
  const inUse = file.refCount > 0;
  askConfirm({
    title: inUse ? "该图标正在使用中" : "删除图标",
    message: inUse
      ? `「${file.name}」正被 ${file.refCount} 张卡片使用，删除后这些卡片会缺图。仍要删除吗？`
      : `确定要删除「${file.name}」吗？该操作不可撤销。`,
    onConfirm: () => void deleteOne(file, inUse),
  });
};

const doBatchDelete = async (force: boolean) => {
  const names = [...selectedNames.value];
  if (names.length === 0) return;
  busy.value = true;
  try {
    const res = await fetch("/api/icon-cache/batch-delete", {
      method: "POST",
      headers: store.getHeaders(),
      body: JSON.stringify({ names, force }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      showToast(parseIconCacheError(data, res.status).message);
      return;
    }
    const deleted: string[] = Array.isArray(data?.deleted) ? data.deleted : [];
    const skipped: string[] = Array.isArray(data?.skipped) ? data.skipped : [];
    showToast(
      skipped.length > 0
        ? `已删除 ${deleted.length} 个，跳过 ${skipped.length} 个（使用中或不存在）`
        : `已删除 ${deleted.length} 个图标`,
    );
    store.refreshResources();
    clearSelection();
    await fetchList();
  } catch (e) {
    showToast(e instanceof Error ? e.message : "批量删除失败");
  } finally {
    busy.value = false;
  }
};

const requestBatchDelete = () => {
  const names = [...selectedNames.value];
  if (names.length === 0) return;
  if (selectedInUseCount.value > 0) {
    askConfirm({
      title: "包含正在使用的图标",
      message: `选中的 ${names.length} 个图标里有 ${selectedInUseCount.value} 个正在被卡片使用，删除后对应卡片会缺图。仍要删除吗？`,
      onConfirm: () => void doBatchDelete(true),
    });
    return;
  }
  askConfirm({
    title: "批量删除",
    message: `确定要删除选中的 ${names.length} 个图标吗？该操作不可撤销。`,
    onConfirm: () => void doBatchDelete(false),
  });
};

// ---- 清理未引用 ----
const doCleanup = async () => {
  busy.value = true;
  try {
    const res = await fetch("/api/icon-cache/cleanup", {
      method: "POST",
      headers: store.getHeaders(),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      showToast(parseIconCacheError(data, res.status).message);
      return;
    }
    const deleted: string[] = Array.isArray(data?.deleted) ? data.deleted : [];
    const freed = Number(data?.freedBytes) || 0;
    showToast(
      deleted.length > 0
        ? `已清理 ${deleted.length} 个未引用图标，释放 ${formatBytes(freed)}`
        : "没有可清理的未引用图标",
    );
    store.refreshResources();
    await fetchList();
  } catch (e) {
    showToast(e instanceof Error ? e.message : "清理失败");
  } finally {
    busy.value = false;
  }
};

const requestCleanup = () => {
  if (unreferencedCount.value === 0) {
    showToast("没有可清理的未引用图标");
    return;
  }
  askConfirm({
    title: "清理未引用图标",
    message: `将删除 ${unreferencedCount.value} 个没有被任何卡片引用的图标，释放约 ${formatBytes(
      unreferencedSize.value,
    )}。继续吗？`,
    onConfirm: () => void doCleanup(),
  });
};

// ---- 上传 ----
const triggerUpload = () => uploadInput.value?.click();

const handleUploadChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const picked = input.files?.[0];
  input.value = "";
  if (!picked) return;

  uploading.value = true;
  try {
    const dataUrl = await readFileAsDataUrl(picked);
    if (!dataUrl) {
      showToast("读取图片失败");
      return;
    }
    const res = await fetch("/api/icon-cache", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.path) {
      showToast(parseIconCacheError(data, res.status).message);
      return;
    }
    showToast(data.cacheHit ? "该图标已存在，直接复用" : "已上传到图标缓存");
    store.refreshResources();
    await fetchList();
  } catch (e) {
    showToast(e instanceof Error ? e.message : "上传失败");
  } finally {
    uploading.value = false;
  }
};

const copyPath = async (path: string) => {
  try {
    await navigator.clipboard.writeText(path);
    showToast("已复制路径");
  } catch {
    showToast(path);
  }
};

const formatDate = (seconds: number) => {
  if (!seconds) return "—";
  try {
    return new Date(seconds * 1000).toLocaleString();
  } catch {
    return "—";
  }
};

const shortName = (name: string) => (name.length > 18 ? `${name.slice(0, 16)}…` : name);

onMounted(fetchList);
</script>

<template>
  <div class="space-y-4">
    <!-- 说明条 -->
    <div class="bg-blue-50/80 border border-blue-100 text-blue-900 rounded-xl px-4 py-3 text-xs leading-relaxed">
      <div class="font-bold mb-0.5">图标缓存</div>
      <div>
        所有卡片图标会转换并缓存到服务器本地，<b>全局共享、按内容去重</b>。删除正在被卡片使用的图标会让对应卡片缺图，
        所以「使用中」的图标默认会被保护起来。
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="bg-white/70 border border-gray-100 rounded-xl p-3 space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative flex-1 min-w-[160px]">
          <input
            v-model="keyword"
            type="search"
            placeholder="搜索文件名…"
            class="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
          />
          <svg
            class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />
          </svg>
        </div>

        <select
          v-model="sortMode"
          class="px-2.5 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-blue-400"
          title="排序方式"
        >
          <option value="newest">最新上传</option>
          <option value="oldest">最早上传</option>
          <option value="name">按名称</option>
          <option value="size">按体积</option>
          <option value="refs">按使用次数</option>
        </select>

        <label
          class="flex items-center gap-1.5 px-2.5 py-2 text-sm border rounded-lg cursor-pointer select-none transition-colors"
          :class="onlyUnused ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'"
        >
          <input v-model="onlyUnused" type="checkbox" class="accent-amber-500" />
          仅看未使用
        </label>

        <button
          class="px-3 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
          :disabled="loading"
          @click="fetchList"
        >
          刷新
        </button>
        <button
          class="px-3 py-2 text-sm rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-200 transition-colors disabled:opacity-50"
          :disabled="uploading"
          @click="triggerUpload"
        >
          {{ uploading ? "上传中…" : "上传图标" }}
        </button>
        <input
          ref="uploadInput"
          type="file"
          :accept="ICON_CACHE_ACCEPT"
          class="hidden"
          @change="handleUploadChange"
        />
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <div class="flex items-center gap-3">
          <span>
            共 <b class="text-gray-700">{{ summary.totalCount }}</b> 个 ·
            合计 <b class="text-gray-700">{{ formatBytes(summary.totalSize) }}</b>
          </span>
          <span v-if="summary.unreferencedCount > 0" class="text-amber-600">
            未使用 {{ summary.unreferencedCount }} 个 · {{ formatBytes(unreferencedSize) }}
          </span>
        </div>
        <button
          class="px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-40"
          :class="unreferencedCount > 0 ? 'border-amber-300 text-amber-700 hover:bg-amber-50' : 'border-gray-200 text-gray-400'"
          :disabled="unreferencedCount === 0 || busy"
          @click="requestCleanup"
        >
          一键清理未引用
        </button>
      </div>
    </div>

    <!-- 批量操作条 -->
    <div
      v-if="selectedNames.length > 0"
      class="flex flex-wrap items-center gap-2 bg-gray-900 text-white rounded-xl px-3 py-2 text-xs"
    >
      <span>已选 {{ selectedNames.length }} 个</span>
      <span v-if="selectedInUseCount > 0" class="text-amber-300">（其中 {{ selectedInUseCount }} 个使用中）</span>
      <div class="flex-1"></div>
      <button class="px-2.5 py-1.5 rounded-lg hover:bg-white/15 transition-colors" @click="toggleSelectAllVisible">
        {{ allVisibleSelected ? "取消全选" : "全选当前" }}
      </button>
      <button class="px-2.5 py-1.5 rounded-lg hover:bg-white/15 transition-colors" @click="clearSelection">
        清空
      </button>
      <button
        class="px-2.5 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 font-bold transition-colors disabled:opacity-50"
        :disabled="busy"
        @click="requestBatchDelete"
      >
        删除所选
      </button>
    </div>

    <!-- 状态区 -->
    <div v-if="loading" class="py-12 flex flex-col items-center justify-center text-gray-400">
      <div class="w-8 h-8 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-2"></div>
      <span class="text-xs">加载中…</span>
    </div>

    <div
      v-else-if="errorMessage"
      class="py-10 flex flex-col items-center justify-center gap-3 text-gray-400"
    >
      <span class="text-3xl">⚠️</span>
      <span class="text-xs">{{ errorMessage }}</span>
      <button class="px-3 py-1.5 text-xs rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600" @click="fetchList">
        重试
      </button>
    </div>

    <div v-else-if="files.length === 0" class="py-14 flex flex-col items-center justify-center text-gray-400">
      <span class="text-4xl mb-2">🖼️</span>
      <span class="text-sm">还没有缓存图标</span>
      <span class="text-xs mt-1">在编辑卡片时上传，或点上面的「上传图标」</span>
    </div>

    <div v-else-if="visibleFiles.length === 0" class="py-12 text-center text-xs text-gray-400">
      没有符合当前筛选条件的图标
    </div>

    <!-- 图标网格：设置面板内容区约 670px 宽，列数按内容区适配（8 列会让每卡不足 80px、操作按钮被拆成单字） -->
    <div v-else class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-3">
      <div
        v-for="file in visibleFiles"
        :key="file.name"
        :data-icon-name="file.name"
        class="group relative rounded-xl border bg-white overflow-hidden transition-all hover:shadow-md"
        :class="isSelected(file.name) ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200 hover:border-blue-300'"
      >
        <!-- overflow-hidden 是必需的：下面那条悬浮操作栏靠 translate-y-full 藏在缩略图下方，
             不裁剪的话它只是"往下挪了一行"，正好压在底部的文件名/体积上（实测压掉 29.5/44.5px） -->
        <div class="relative aspect-square overflow-hidden flex items-center justify-center" :style="checkerboardStyle">
          <img
            :src="store.getAssetUrl(file.path)"
            class="max-w-[64%] max-h-[64%] object-contain"
            loading="lazy"
            :alt="file.name"
          />

          <!-- 引用徽标 -->
          <span
            class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold shadow-sm"
            :class="file.refCount > 0 ? 'bg-emerald-500 text-white' : 'bg-gray-200/90 text-gray-500'"
          >
            {{ file.refCount > 0 ? `使用中 ${file.refCount}` : "未使用" }}
          </span>

          <!-- 勾选 -->
          <input
            type="checkbox"
            class="absolute top-1.5 right-1.5 w-4 h-4 accent-blue-600 cursor-pointer"
            :checked="isSelected(file.name)"
            :aria-label="`选择 ${file.name}`"
            @change="toggleSelect(file.name)"
          />

          <!-- 悬浮操作：静止态用 translate-y-full 藏到缩略图下方，靠父级 overflow-hidden 裁掉。
               这里刻意**不用 `invisible`/`visibility:hidden`** —— 那会让按钮无法获得焦点，
               键盘用户就彻底用不了这三个操作了。改用 opacity-0 + pointer-events-none：
               对鼠标不可见也不可点，但仍在 Tab 顺序里；键盘聚焦进来时由
               group-focus-within 显形（同时把 translate 归零，从缩略图下方滑出来）。 -->
          <div
            class="absolute inset-x-0 bottom-0 flex translate-y-full opacity-0 pointer-events-none transition
                   group-hover:translate-y-0 group-hover:opacity-100 group-hover:pointer-events-auto
                   group-focus-within:translate-y-0 group-focus-within:opacity-100 group-focus-within:pointer-events-auto
                   bg-white/95 backdrop-blur border-t border-gray-100"
          >
            <button
              class="flex-1 py-1.5 text-[11px] whitespace-nowrap text-gray-600 hover:bg-gray-100 transition-colors"
              title="复制路径"
              @click.stop="copyPath(file.path)"
            >
              复制
            </button>
            <button
              class="flex-1 py-1.5 text-[11px] whitespace-nowrap text-gray-600 hover:bg-gray-100 transition-colors border-x border-gray-100"
              title="查看信息"
              @click.stop="openInfo(file)"
            >
              信息
            </button>
            <button
              class="flex-1 py-1.5 text-[11px] whitespace-nowrap text-red-500 hover:bg-red-50 transition-colors"
              title="删除"
              @click.stop="requestDelete(file)"
            >
              删除
            </button>
          </div>
        </div>

        <div class="px-2 py-1.5 border-t border-gray-100">
          <div class="text-[11px] text-gray-700 truncate" :title="file.name">
            {{ shortName(file.name) }}
          </div>
          <div class="text-[10px] text-gray-400">{{ formatBytes(file.size) }}</div>
        </div>
      </div>
    </div>

    <!-- 信息弹窗 -->
    <OverlayMotion
      :show="showInfo"
      :z-index="120"
      close-on-overlay
      overlay-class="bg-black/50 backdrop-blur-sm p-4"
      panel-class="max-w-md w-full"
      @close="showInfo = false"
    >
      <div v-if="infoFile" class="bg-white rounded-2xl shadow-2xl w-full p-5">
        <div class="flex items-center gap-4">
          <div class="w-20 h-20 rounded-xl border border-gray-200 flex items-center justify-center" :style="checkerboardStyle">
            <img :src="store.getAssetUrl(infoFile.path)" class="max-w-[70%] max-h-[70%] object-contain" />
          </div>
          <div class="min-w-0">
            <div class="font-bold text-gray-900 text-sm break-all">{{ infoFile.name }}</div>
            <div class="text-xs mt-1">
              <span
                class="px-2 py-0.5 rounded-full font-bold"
                :class="infoFile.refCount > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'"
              >
                {{ infoFile.refCount > 0 ? `被 ${infoFile.refCount} 张卡片使用` : "未被使用" }}
              </span>
            </div>
          </div>
        </div>

        <dl class="mt-4 space-y-2 text-xs">
          <div class="flex gap-3">
            <dt class="w-16 shrink-0 text-gray-400">路径</dt>
            <dd class="flex-1 text-gray-700 break-all">{{ infoFile.path }}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-16 shrink-0 text-gray-400">体积</dt>
            <dd class="flex-1 text-gray-700">{{ formatBytes(infoFile.size) }}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-16 shrink-0 text-gray-400">上传时间</dt>
            <dd class="flex-1 text-gray-700">{{ formatDate(infoFile.modifiedAt) }}</dd>
          </div>
        </dl>

        <div class="mt-5 flex justify-end gap-2">
          <button
            class="px-3 py-2 text-sm rounded-lg text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
            @click="copyPath(infoFile.path)"
          >
            复制路径
          </button>
          <button
            class="px-4 py-2 text-sm rounded-lg text-white bg-gray-900 hover:bg-gray-800 transition-colors"
            @click="showInfo = false"
          >
            关闭
          </button>
        </div>
      </div>
    </OverlayMotion>

    <!-- 确认弹窗 -->
    <OverlayMotion
      :show="showConfirm"
      :z-index="140"
      close-on-overlay
      overlay-class="bg-black/60 backdrop-blur-sm p-4"
      panel-class="max-w-sm w-full"
      @close="closeConfirm"
    >
      <div class="bg-white rounded-2xl shadow-2xl w-full p-6">
        <div class="flex items-start gap-4 mb-4">
          <div class="p-2 rounded-full shrink-0" :class="confirmDanger ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'">
            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 class="text-base font-bold text-gray-900 mb-1">{{ confirmTitle }}</h3>
            <p class="text-sm text-gray-600 leading-relaxed">{{ confirmMessage }}</p>
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors" @click="closeConfirm">
            取消
          </button>
          <button
            class="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors shadow-sm"
            :class="confirmDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'"
            @click="runConfirm"
          >
            确定
          </button>
        </div>
      </div>
    </OverlayMotion>

    <!-- 轻提示 -->
    <Transition name="overlay-motion-root">
      <div
        v-if="toast"
        class="fixed left-1/2 -translate-x-1/2 bottom-8 z-[200] px-4 py-2 rounded-full bg-gray-900/90 text-white text-xs shadow-lg"
      >
        {{ toast }}
      </div>
    </Transition>
  </div>
</template>
