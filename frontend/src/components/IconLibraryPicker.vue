<script setup lang="ts">
/**
 * 「从图标库选择」弹窗 —— 浏览**已经缓存到服务器**的图标。
 *
 * 与 IconSelectionModal 的区别：那个是「智能匹配候选（含 10 秒自动选择倒计时）」，
 * 适合按标题/链接自动猜图标；这里是**人肉浏览自己上传过的图标库**，
 * 所以没有倒计时、可搜索、可直接再上传一个。
 *
 * 选中的是本地路径（/icon-cache/xxx.webp），卡片本来就存这个，零额外处理。
 */
import { computed, ref, watch } from "vue";
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
  type IconCacheFile,
} from "@/utils/iconCache";

const props = withDefaults(
  defineProps<{
    show: boolean;
    title?: string;
  }>(),
  { title: "图标库" },
);

const emit = defineEmits<{
  (e: "update:show", value: boolean): void;
  (e: "select", path: string): void;
}>();

const store = useMainStore();

const loading = ref(false);
const errorMessage = ref("");
const files = ref<IconCacheFile[]>([]);
const keyword = ref("");
const uploading = ref(false);
const uploadInput = ref<HTMLInputElement | null>(null);

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

const visibleFiles = computed(() =>
  sortIconFiles(filterIconFiles(files.value, keyword.value), "newest"),
);

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
    files.value = parseIconCacheList(data).files;
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : "加载失败，请稍后重试";
  } finally {
    loading.value = false;
  }
};

const close = () => emit("update:show", false);

const pick = (file: IconCacheFile) => {
  emit("select", file.path);
  close();
};

const triggerUpload = () => uploadInput.value?.click();

const uploadError = ref("");

const handleUploadChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const picked = input.files?.[0];
  input.value = "";
  if (!picked) return;

  uploading.value = true;
  uploadError.value = "";
  try {
    const dataUrl = await readFileAsDataUrl(picked);
    const res = await fetch("/api/icon-cache", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.path) {
      uploadError.value = parseIconCacheError(data, res.status).message;
      return;
    }
    const path = String(data.path);
    store.refreshResources();
    await fetchList();
    // 刚上传的图标直接选用，少点一次
    emit("select", path);
    close();
  } catch (e) {
    uploadError.value = e instanceof Error ? e.message : "上传失败";
  } finally {
    uploading.value = false;
  }
};

watch(
  () => props.show,
  (visible) => {
    if (visible) {
      keyword.value = "";
      uploadError.value = "";
      void fetchList();
    }
  },
  { immediate: true },
);
</script>

<template>
  <OverlayMotion
    :show="show"
    :z-index="200"
    close-on-overlay
    overlay-class="bg-black/50 backdrop-blur-sm p-4"
    panel-class="max-w-3xl w-full"
    @close="close"
  >
    <div class="bg-white rounded-2xl shadow-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0">
          <h3 class="text-base font-bold text-gray-900 truncate">📚 {{ title }}</h3>
          <span class="shrink-0 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {{ files.length }} 个
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="px-3 py-1.5 text-xs font-bold rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-200 transition-colors disabled:opacity-50"
            :disabled="uploading"
            @click="triggerUpload"
          >
            {{ uploading ? "上传中…" : "上传新图标" }}
          </button>
          <input
            ref="uploadInput"
            type="file"
            :accept="ICON_CACHE_ACCEPT"
            class="hidden"
            @change="handleUploadChange"
          />
          <button
            class="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors"
            @click="close"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- Toolbar -->
      <div class="px-5 py-3 bg-gray-50 border-b border-gray-100">
        <input
          v-model="keyword"
          type="search"
          placeholder="搜索已上传的图标…"
          class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:border-blue-400 outline-none"
        />
        <p v-if="uploadError" class="mt-2 text-xs text-red-500">{{ uploadError }}</p>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-5">
        <div v-if="loading" class="h-40 flex flex-col items-center justify-center text-gray-400">
          <div class="w-8 h-8 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-2"></div>
          <span class="text-xs">加载中…</span>
        </div>

        <div v-else-if="errorMessage" class="h-40 flex flex-col items-center justify-center gap-3 text-gray-400">
          <span class="text-3xl">⚠️</span>
          <span class="text-xs">{{ errorMessage }}</span>
          <button class="px-3 py-1.5 text-xs rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600" @click="fetchList">
            重试
          </button>
        </div>

        <div v-else-if="files.length === 0" class="h-40 flex flex-col items-center justify-center text-gray-400">
          <span class="text-4xl mb-2">🖼️</span>
          <span class="text-sm">还没有缓存图标</span>
          <span class="text-xs mt-1">点右上角「上传新图标」加一个</span>
        </div>

        <div v-else-if="visibleFiles.length === 0" class="h-40 flex items-center justify-center text-xs text-gray-400">
          没有匹配「{{ keyword }}」的图标
        </div>

        <div v-else class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
          <button
            v-for="file in visibleFiles"
            :key="file.name"
            type="button"
            class="group flex flex-col items-center gap-2 p-2 rounded-xl border border-gray-100 hover:border-blue-300 hover:bg-blue-50/50 hover:shadow-sm transition-all"
            :title="file.name"
            @click="pick(file)"
          >
            <span
              class="w-14 h-14 rounded-lg border border-gray-200 flex items-center justify-center overflow-hidden"
              :style="checkerboardStyle"
            >
              <img
                :src="store.getAssetUrl(file.path)"
                class="max-w-[72%] max-h-[72%] object-contain group-hover:scale-110 transition-transform"
                loading="lazy"
                :alt="file.name"
              />
            </span>
            <span class="w-full text-[10px] text-gray-500 truncate text-center">
              {{ file.name }}
            </span>
            <span class="text-[9px] text-gray-400">{{ formatBytes(file.size) }}</span>
          </button>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
        <span>点图标即选用该图标（本地路径，无需再缓存）</span>
        <button
          class="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          @click="close"
        >
          取消
        </button>
      </div>
    </div>
  </OverlayMotion>
</template>
