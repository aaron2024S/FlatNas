<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { NavItem, SysStatConfig } from "@/types";
import SystemStatCard from "./SystemStatCard.vue";
import SysStatColorPicker from "./SysStatColorPicker.vue";
import { useSystemStats } from "@/composables/useSystemStats";
import {
  isLegacySysStatTextColor,
  isLegacySysStatBgColor,
  isLegacySysStatPrimaryColor,
  isLegacySysStatSecondaryColor,
} from "@/utils/sysstat";

const props = defineProps<{
  item: NavItem;
  /** 新建模式：卡片类型三个 tab 都可点（默认磁盘） */
  create?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:show", v: boolean): void;
  (e: "save", payload: { item: NavItem; sysStat: SysStatConfig; isPublic: boolean }): void;
}>();

const KIND_LABELS: [SysStatConfig["kind"], string][] = [
  ["cpu", "CPU状态"],
  ["mem", "内存状态"],
  ["disk", "磁盘状态"],
];

// 颜色留空 = 跟随卡片默认样式（普通卡片背景 + 标题文字色）
const DEFAULT_TEXT_COLOR = "";
const DEFAULT_BG_COLOR = "";

// 挂载点列表来自后端 /api/system/stats 实际上报的 disk[].mount，
// 不再写死：容器里 yaml 映射成什么路径就显示什么路径。
const { stats, refresh } = useSystemStats();
void refresh();

const kind = ref<SysStatConfig["kind"]>("cpu");
const mount = ref("");
const title = ref("");
const isPublic = ref(true);
const primaryColor = ref(DEFAULT_TEXT_COLOR);
const secondaryColor = ref(DEFAULT_TEXT_COLOR);
const textColor = ref(DEFAULT_TEXT_COLOR);
const bgColor = ref(DEFAULT_BG_COLOR);

// 从当前卡片初始化
watch(
  () => props.item,
  (item) => {
    const s = item.sysStat;
    kind.value = s?.kind ?? (props.create ? "disk" : "cpu");
    mount.value = s?.mount ?? "";
    title.value = s?.title ?? "";
    isPublic.value = item.isPublic !== false;
    // 旧版默认色（主/副/文字/背景）视为未设置，显示为空 = 跟随普通卡默认
    // （新取色器存的是 8 位 #RRGGBBAA，不会命中这些 6 位旧值）
    primaryColor.value =
      s?.primaryColor && !isLegacySysStatPrimaryColor(s.primaryColor)
        ? s.primaryColor
        : DEFAULT_TEXT_COLOR;
    secondaryColor.value =
      s?.secondaryColor && !isLegacySysStatSecondaryColor(s.secondaryColor)
        ? s.secondaryColor
        : DEFAULT_TEXT_COLOR;
    textColor.value =
      s?.textColor && !isLegacySysStatTextColor(s.textColor) ? s.textColor : DEFAULT_TEXT_COLOR;
    bgColor.value =
      s?.bgColor && !isLegacySysStatBgColor(s.bgColor) && s.bgColor !== "transparent"
        ? s.bgColor
        : DEFAULT_BG_COLOR;
  },
  { immediate: true },
);

// 磁盘卡且未选挂载点时，默认选中后端上报的第一个挂载点
watch(
  () => stats.value?.disk,
  (disks) => {
    if (kind.value === "disk" && !mount.value && disks?.length) {
      mount.value = disks[0].mount;
    }
  },
  { immediate: true },
);

// 容器自身 bind-mount 过滤（与后端 isInternalMountpoint 同规则，兼容旧后端）：
// /etc/*、/app/*、docker overlay merged（含 @docker）
const isInternalMount = (m: string) =>
  m === "/etc" ||
  m.startsWith("/etc/") ||
  m === "/app" ||
  m.startsWith("/app/") ||
  m.includes("@docker");

// 挂载点候选：后端实际挂载（过滤内部路径后排序去重），并保证当前已选值始终在列
const backendMounts = computed(() => {
  const list = (stats.value?.disk ?? [])
    .map((d) => d.mount)
    .filter((m) => m && !isInternalMount(m));
  return [...new Set(list)].sort();
});
const mountOptions = computed(() => {
  const set = new Set(backendMounts.value);
  if (mount.value) set.add(mount.value);
  return [...set];
});

const isDisk = computed(() => kind.value === "disk");

const buildConfig = (): SysStatConfig => ({
  kind: kind.value,
  ...(kind.value === "disk" && mount.value ? { mount: mount.value } : {}),
  ...(title.value.trim() ? { title: title.value.trim() } : {}),
  ...(primaryColor.value.trim() ? { primaryColor: primaryColor.value.trim() } : {}),
  ...(secondaryColor.value.trim() ? { secondaryColor: secondaryColor.value.trim() } : {}),
  ...(textColor.value.trim() ? { textColor: textColor.value.trim() } : {}),
  ...(bgColor.value.trim() ? { bgColor: bgColor.value.trim() } : {}),
});

const demoItem = computed<NavItem>(() => ({
  ...props.item,
  sysStat: buildConfig(),
}));

// 预览：模拟普通卡片的实际观感（默认浅色卡片背景 + 深色文字）
const previewBg = computed(() => bgColor.value.trim() || "var(--card-bg-color, #ffffff)");
const previewTitleColor = computed(() => textColor.value.trim() || "#111827");

const resetDefaults = () => {
  title.value = "";
  primaryColor.value = DEFAULT_TEXT_COLOR;
  secondaryColor.value = DEFAULT_TEXT_COLOR;
  textColor.value = DEFAULT_TEXT_COLOR;
  bgColor.value = DEFAULT_BG_COLOR;
};

const confirm = () => {
  emit("save", { item: props.item, sysStat: buildConfig(), isPublic: isPublic.value });
  emit("update:show", false);
};

const close = () => emit("update:show", false);
</script>

<template>
  <div
    class="fixed inset-0 z-[95] bg-black/20 backdrop-blur-sm flex items-center justify-center p-4"
    @mousedown.self="close"
  >
    <div
      class="w-full max-w-md bg-white text-gray-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]"
    >
      <!-- 头部（与普通卡片编辑弹窗一致：白底 + 灰分隔线 + 灰 X） -->
      <div class="flex items-center px-6 py-4 border-b border-gray-100 bg-white select-none">
        <h3 class="text-lg font-bold text-gray-800">
          {{ props.create ? "添加状态卡片" : "编辑" }}
        </h3>
        <!-- 公开开关（与普通卡片编辑弹窗同款）：未登录访客是否可见该卡片 -->
        <div class="flex items-center gap-2 ml-auto mr-4">
          <span class="text-xs font-bold text-gray-500">公开</span>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" v-model="isPublic" class="sr-only peer" />
            <div
              class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-gray-900"
            ></div>
          </label>
        </div>
        <button
          class="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          aria-label="关闭"
          @click="close"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Tabs（白底风格：选中深灰底白字，未选中灰字） -->
      <div class="flex gap-1 mx-6 mt-4 bg-gray-100 rounded-lg p-1">
        <button
          v-for="[k, label] in KIND_LABELS"
          :key="k"
          type="button"
          class="flex-1 py-1.5 rounded-md text-xs font-medium transition-colors"
          :class="
            kind === k
              ? 'bg-gray-900 text-white shadow'
              : props.create
                ? 'text-gray-700 hover:text-gray-900 hover:bg-gray-200/70'
                : 'text-gray-400 cursor-not-allowed opacity-60'
          "
          :disabled="kind === k"
          :title="
            kind === k
              ? ''
              : props.create
                ? `切换到${label}类型`
                : '卡片类型创建后固定，请新建对应类型的卡片'
          "
          @click="props.create && (kind = k as SysStatConfig['kind'])"
        >
          {{ label }}
        </button>
      </div>

      <div class="overflow-y-auto custom-scrollbar px-6 pb-4">
        <!-- DEMO 预览：模拟普通卡片（浅色背景 + 深色文字）的实际观感 -->
        <div
          class="mt-4 rounded-lg p-4 border border-gray-100"
          style="
            background-color: #ffffff;
            background-image:
              linear-gradient(45deg, #ececec 25%, transparent 25%),
              linear-gradient(-45deg, #ececec 25%, transparent 25%),
              linear-gradient(45deg, transparent 75%, #ececec 75%),
              linear-gradient(-45deg, transparent 75%, #ececec 75%);
            background-size: 16px 16px;
            background-position: 0 0, 0 8px, 8px -8px, -8px 0;
          "
        >
          <div
            class="h-14 rounded-xl overflow-hidden flex items-center px-3 border border-gray-200"
            :style="{ backgroundColor: previewBg }"
          >
            <SystemStatCard
              :item="demoItem"
              :demo="true"
              :icon-size="32"
              :title-color="previewTitleColor"
            />
          </div>
        </div>

        <!-- 磁盘专属：挂载点 + 自定义标题 -->
        <template v-if="isDisk">
          <div class="mt-4">
            <div class="text-xs font-medium text-gray-500 mb-1.5">
              挂载点 <span class="text-red-400">*</span>
            </div>
            <select
              v-model="mount"
              class="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-900 transition-colors"
            >
              <option v-if="!mountOptions.length" disabled value="">
                正在获取挂载点…
              </option>
              <option v-for="m in mountOptions" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>

          <div class="mt-3">
            <div class="text-xs font-medium text-gray-500 mb-1.5">自定义标题</div>
            <input
              v-model="title"
              type="text"
              placeholder="磁盘1"
              class="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-900 transition-colors placeholder:text-gray-400"
            />
          </div>
        </template>

        <!-- 颜色字段：sun-panel 风格 2×2 布局（主色+副色一行，文字+背景一行） -->
        <div class="mt-4 grid grid-cols-2 gap-x-3 gap-y-3">
          <div>
            <div class="text-xs font-medium text-gray-500 mb-1.5">主色</div>
            <SysStatColorPicker v-model="primaryColor" />
          </div>
          <div>
            <div class="text-xs font-medium text-gray-500 mb-1.5">副色</div>
            <SysStatColorPicker v-model="secondaryColor" />
          </div>
          <div>
            <div class="text-xs font-medium text-gray-500 mb-1.5">文字颜色</div>
            <SysStatColorPicker v-model="textColor" />
          </div>
          <div>
            <div class="text-xs font-medium text-gray-500 mb-1.5">背景颜色</div>
            <SysStatColorPicker v-model="bgColor" />
          </div>
        </div>
        <div class="mt-2 text-[11px] text-gray-400">
          留空表示跟随普通卡片样式；透明度拉到 0（或点预设里的透明格）= 恢复跟随默认。
        </div>
      </div>

      <!-- 底部（与普通卡片编辑弹窗一致） -->
      <div class="flex items-center justify-between px-6 py-4 bg-white border-t border-gray-100">
        <button
          type="button"
          class="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors text-sm font-medium"
          @click="resetDefaults"
        >
          重置
        </button>
        <button
          type="button"
          class="px-6 py-2 rounded-lg bg-gray-900 text-white hover:bg-black transition-all active:scale-95 text-sm font-medium"
          @click="confirm"
        >
          确定
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 2px;
}
</style>
