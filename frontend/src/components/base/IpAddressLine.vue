<script setup lang="ts">
import { computed, ref } from "vue";
import { useResizeObserver } from "@vueuse/core";
import { fitIpAddress } from "@/utils/ipAddressFit";

/**
 * 一行「标签 + 地址」。
 *
 * 两条硬约束，缺一个就会退化成之前那个样子：
 *   - 标签必须 shrink-0 + whitespace-nowrap，否则长地址会把它挤成竖排；
 *   - 地址必须 whitespace-nowrap + overflow-hidden，否则会在字符中间被撕成两行。
 *
 * 地址占满剩余宽度（flex-1），既保证点击区域是整行、也让我们能直接量到可用宽度，
 * 字号与省略交给 fitIpAddress 决定。字号变化不会反过来改变自身宽度（宽度由父级决定），
 * 所以不存在「测量 → 改字号 → 宽度变化 → 再测量」的循环。
 */
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

const addrEl = ref<HTMLElement | null>(null);
const availableWidth = ref(0);

useResizeObserver(addrEl, (entries) => {
  const width = entries[0]?.contentRect?.width ?? 0;
  if (width > 0 && Math.abs(width - availableWidth.value) > 0.5) {
    availableWidth.value = width;
  }
});

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
  <div class="flex w-full min-w-0 items-center justify-center gap-2">
    <span
      class="shrink-0 whitespace-nowrap uppercase opacity-70"
      :style="{ fontSize: `${labelFontSize}px` }"
    >
      {{ label }}
    </span>
    <button
      ref="addrEl"
      type="button"
      class="ip-address-value min-w-0 flex-1 overflow-hidden whitespace-nowrap text-center font-mono font-medium leading-tight select-text transition-opacity hover:opacity-90"
      :class="muted ? 'opacity-70' : ''"
      :style="{ fontSize: `${fit.fontSize}px` }"
      :title="`点击复制${label} IP：${value}`"
      @click.stop="emit('copy', value)"
    >
      {{ fit.display }}
    </button>
  </div>
</template>
