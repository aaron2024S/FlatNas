<script setup lang="ts">
import { computed, ref } from "vue";
import { useResizeObserver } from "@vueuse/core";
import { fitIpAddress } from "@/utils/ipAddressFit";

/**
 * 一行「标签 + 地址」。
 *
 * 三条硬约束，缺一个就会退化成之前那个样子：
 *   - 标签必须 shrink-0 + whitespace-nowrap，否则长地址会把它挤成竖排；
 *   - 地址必须 whitespace-nowrap + overflow-hidden，否则会在字符中间被撕成两行；
 *   - 地址必须按**内容宽度**收窄、与标签一起居中，不能 flex-1 撑满剩余宽度 ——
 *     否则「外网」会被顶到行首、地址在剩下那一大块里居中，卡片一拖宽两者就隔得很远。
 *
 * 代价是可用宽度不能再直接量地址元素：地址宽度＝它自己的内容宽度，
 * 量出来是「结果」而不是「约束」，会自激。所以改成量整行宽度与标签宽度相减。
 * 标签宽度只由字号决定（字号是 props，不由宽度反推），因此不存在测量循环。
 */

/** 标签与地址之间的间距。写死像素而非 gap-2，免得 rem 基准变化时和估算对不上 */
const LABEL_GAP_PX = 8;

const props = withDefaults(
  defineProps<{
    label: string;
    value: string;
    /** 期望字号，放得下就用它 */
    baseFontSize?: number;
    /** 标签字号 */
    labelFontSize?: number;
    /** 地址允许缩到的最小字号 */
    minFontSize?: number;
    /** 弱化显示（用于次要的那一行地址） */
    muted?: boolean;
  }>(),
  {
    baseFontSize: 20,
    labelFontSize: 12,
    minFontSize: 10,
    muted: false,
  },
);

const emit = defineEmits<{
  (e: "copy", value: string): void;
}>();

const rowEl = ref<HTMLElement | null>(null);
const labelEl = ref<HTMLElement | null>(null);
const rowWidth = ref(0);
const labelWidth = ref(0);

useResizeObserver(rowEl, (entries) => {
  const width = entries[0]?.contentRect?.width ?? 0;
  if (width > 0 && Math.abs(width - rowWidth.value) > 0.5) {
    rowWidth.value = width;
  }
});

useResizeObserver(labelEl, (entries) => {
  const width = entries[0]?.contentRect?.width ?? 0;
  if (width > 0 && Math.abs(width - labelWidth.value) > 0.5) {
    labelWidth.value = width;
  }
});

/** 留给地址的宽度 = 整行 − 标签 − 间距 */
const availableWidth = computed(() =>
  Math.max(0, rowWidth.value - labelWidth.value - LABEL_GAP_PX),
);

const fit = computed(() =>
  fitIpAddress({
    text: props.value,
    availableWidth: availableWidth.value,
    baseFontSize: props.baseFontSize,
    minFontSize: props.minFontSize,
  }),
);
</script>

<template>
  <!-- 整行都是点击区：地址收窄后按钮本身变小，把复制动作挂在行上才不至于难点 -->
  <div
    ref="rowEl"
    class="ip-address-line flex w-full min-w-0 cursor-pointer items-center justify-center"
    :style="{ gap: `${LABEL_GAP_PX}px` }"
    :title="`点击复制${label} IP：${value}`"
    @click.stop="emit('copy', value)"
  >
    <span
      ref="labelEl"
      class="shrink-0 whitespace-nowrap uppercase opacity-70"
      :style="{ fontSize: `${labelFontSize}px` }"
    >
      {{ label }}
    </span>
    <span
      class="ip-address-value min-w-0 overflow-hidden whitespace-nowrap font-mono font-medium leading-tight select-text transition-opacity hover:opacity-90"
      :class="muted ? 'opacity-70' : ''"
      :style="{ fontSize: `${fit.fontSize}px` }"
    >
      {{ fit.display }}
    </span>
  </div>
</template>
