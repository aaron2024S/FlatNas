<script setup lang="ts">
import { computed } from "vue";
import type { NavItem, SysStatConfig } from "@/types";
import { useSystemStats } from "@/composables/useSystemStats";
import { isLegacySysStatTextColor, isLegacySysStatBgColor, isLegacySysStatPrimaryColor, isLegacySysStatSecondaryColor } from "@/utils/sysstat";

const props = defineProps<{
  item: NavItem;
  /** 编辑弹窗 DEMO 预览：不取真实数据，显示示例值 */
  demo?: boolean;
  /** 图标区尺寸（跟随所在分组的 iconSize），实际图形按 0.62 倍绘制 */
  iconSize?: number;
  /** 默认文字颜色：由外层卡片传入（与普通卡片标题色一致） */
  titleColor?: string;
}>();

const { stats } = useSystemStats();

const cfg = computed<SysStatConfig>(() => props.item.sysStat || { kind: "cpu" });

// 背景默认透明：卡片背景由外层卡片容器提供（与普通卡片同一套），
// 避免内部再叠一层深色底（曾出现"卡片里还有一层更黑的底"）。
const DEFAULT_TEXT_FALLBACK = "#111827";

const label = computed(() => {
  if (cfg.value.title) return cfg.value.title;
  if (cfg.value.kind === "cpu") return "CPU";
  if (cfg.value.kind === "mem") return "RAM";
  return "磁盘";
});

const textColor = computed(() => {
  // 旧数据里存的旧版默认白字视为"未设置"，跟随外层普通卡标题色
  if (cfg.value.textColor && !isLegacySysStatTextColor(cfg.value.textColor)) {
    return cfg.value.textColor;
  }
  return props.titleColor || DEFAULT_TEXT_FALLBACK;
});
const bgColor = computed(() => {
  // 真实渲染：背景由 GridPanel 外层容器直接上色（cardBackgroundColor），
  // 内层保持透明——半透明色若内外各画一层会叠加变深。
  // demo 预览（编辑弹窗）没有外层容器，需要自己画背景。
  if (!props.demo) return "transparent";
  const c = cfg.value.bgColor;
  if (!c || c === "transparent" || isLegacySysStatBgColor(c)) return "transparent";
  return c;
});

const iconPx = computed(() => Math.max(18, Math.round((props.iconSize || 32) * 0.62)));

const formatBytesSmart = (bytes: number): string => {
  const tb = bytes / 1024 / 1024 / 1024 / 1024;
  if (tb >= 1) return `${tb.toFixed(1)} TB`;
  const gb = bytes / 1024 / 1024 / 1024;
  return `${gb.toFixed(1)} GB`;
};

// 演示数据（编辑弹窗预览用）
const demoStat = { cpuLoad: 22.78, memUsed: 8.8, memTotal: 23.3, diskUsed: 8.7, diskTotal: 9.1 };

// 取到当前卡片对应的磁盘对象（按挂载点匹配，兜底取第一块盘）
const currentDisk = computed(() => {
  const mount = cfg.value.mount;
  if (!mount) return stats.value?.disk?.[0];
  return stats.value?.disk?.find((d) => d.mount === mount || `${d.mount}/` === mount);
});

// 进度条百分比（CPU 负载 / 内存占用 / 磁盘占用）
const percent = computed(() => {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  if (cfg.value.kind === "cpu") {
    const v = props.demo ? demoStat.cpuLoad : stats.value?.cpu?.currentLoad;
    return v == null ? 0 : clamp(v);
  }
  if (cfg.value.kind === "mem") {
    if (props.demo) return clamp((demoStat.memUsed / demoStat.memTotal) * 100);
    const mem = stats.value?.mem;
    if (!mem?.total) return 0;
    return clamp((mem.used / mem.total) * 100);
  }
  if (props.demo) return clamp((demoStat.diskUsed / demoStat.diskTotal) * 100);
  const disk = currentDisk.value;
  if (!disk?.size) return 0;
  return clamp((disk.used / disk.size) * 100);
});

// 进度条填充色跟随文字色（用户指定用参考图中的白色条——深色卡片上文字为白、
// 条也为白；浅色卡上文字为深、条同步为深，两种主题都保持可见）

// 深色文字用深色轨道，浅色/白色文字（卡片带背景图时）用浅色轨道
const isLightText = computed(() => {
  const c = (textColor.value || "").trim().toLowerCase();
  if (c === "white" || c === "#fff" || c === "#ffffff") return true;
  const m = /^#([0-9a-f]{6})$/.exec(c);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.7;
});

const trackColor = computed(() =>
  isLightText.value ? "rgba(255, 255, 255, 0.3)" : "rgba(0, 0, 0, 0.11)",
);

// 进度条颜色：主色 = 填充（留空跟随文字色），副色 = 轨道（留空用文字色半透明）
// 旧数据里的旧版默认值（#fff / #CFCFCFA8）视为未设置，走跟随逻辑
const barFillColor = computed(() => {
  const p = cfg.value.primaryColor;
  if (p && !isLegacySysStatPrimaryColor(p)) return p;
  return textColor.value;
});
const barTrackColor = computed(() => {
  const s = cfg.value.secondaryColor;
  if (s && !isLegacySysStatSecondaryColor(s)) return s;
  return trackColor.value;
});

const valueText = computed(() => {
  if (cfg.value.kind === "cpu") {
    if (props.demo) return `${demoStat.cpuLoad.toFixed(2)}%`;
    const v = stats.value?.cpu?.currentLoad;
    return v == null ? "--" : `${v.toFixed(2)}%`;
  }
  if (cfg.value.kind === "mem") {
    if (props.demo) return `${demoStat.memUsed} GB/${demoStat.memTotal} GB`;
    const mem = stats.value?.mem;
    if (!mem?.total) return "--";
    return `${formatBytesSmart(mem.used)}/${formatBytesSmart(mem.total)}`;
  }
  if (props.demo) return `${demoStat.diskUsed} TB/${demoStat.diskTotal} TB`;
  const disk = currentDisk.value;
  if (!disk?.size) return "--";
  return `${formatBytesSmart(disk.used)}/${formatBytesSmart(disk.size)}`;
});
</script>

<template>
  <div
    class="sys-stat-card w-full h-full flex items-center gap-2 overflow-hidden"
    :style="{ backgroundColor: bgColor }"
  >
    <!-- 图标（与普通卡片的图标区同位同尺寸，颜色随文字色） -->
    <div class="shrink-0 flex items-center justify-center" :style="{ color: textColor }">
      <!-- CPU：芯片 -->
      <svg
        v-if="cfg.kind === 'cpu'"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        :style="{ width: iconPx + 'px', height: iconPx + 'px' }"
      >
        <rect x="6" y="6" width="12" height="12" rx="1.5" />
        <rect x="9.5" y="9.5" width="5" height="5" rx="0.5" />
        <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
      </svg>
      <!-- RAM：内存条 -->
      <svg
        v-else-if="cfg.kind === 'mem'"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        :style="{ width: iconPx + 'px', height: iconPx + 'px' }"
      >
        <path d="M3 7h18v8H3z" />
        <path d="M6 15v3M10 15v3M14 15v3M18 15v3" />
        <path d="M7 10.5h2M11 10.5h2M15 10.5h2" />
      </svg>
      <!-- 磁盘：硬盘 -->
      <svg
        v-else
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        :style="{ width: iconPx + 'px', height: iconPx + 'px' }"
      >
        <rect x="3" y="8" width="18" height="9" rx="2" />
        <path d="M7 12.5h6" />
        <circle cx="17" cy="12.5" r="0.5" fill="currentColor" />
        <path d="M5 17l-1.2 2M19 17l1.2 2" />
      </svg>
    </div>

    <!-- 标签（左）+ 占用值（右）同行，进度条独占下一行（sun-panel 参考样式） -->
    <div class="flex-1 min-w-0 flex flex-col justify-center gap-1 overflow-hidden">
      <!-- 电脑端：名称左/占用值右同行；手机端（≤768px）：名称一行、占用一行、进度条一行 -->
      <div class="sys-stat-line flex items-baseline justify-between gap-2 leading-tight min-w-0">
        <div
          class="text-xs font-bold truncate"
          :style="{ color: textColor }"
        >
          {{ label }}
        </div>
        <div
          class="text-[10px] font-mono truncate shrink-0 opacity-80"
          :style="{ color: textColor }"
        >
          {{ valueText }}
        </div>
      </div>
      <div
        class="sys-stat-bar w-full rounded-full overflow-hidden"
        :style="{ backgroundColor: barTrackColor }"
        role="progressbar"
        :aria-valuenow="Math.round(percent)"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="label"
      >
        <div
          class="sys-stat-bar-fill h-full rounded-full"
          :style="{ width: percent + '%', backgroundColor: barFillColor }"
        ></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 进度条：3px 细条，宽度平滑过渡（数值每 5s 轮询刷新时不会跳变） */
.sys-stat-bar {
  height: 3px;
  line-height: 0;
}
.sys-stat-bar-fill {
  min-width: 2px;
  transition:
    width 0.6s cubic-bezier(0.4, 0, 0.2, 1),
    background-color 0.4s linear;
}
@media (prefers-reduced-motion: reduce) {
  .sys-stat-bar-fill {
    transition: none;
  }
}
/* 手机端：名称一行、占用一行、进度条一行（共 3 行） */
@media (max-width: 768px) {
  .sys-stat-line {
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
  }
}
</style>
