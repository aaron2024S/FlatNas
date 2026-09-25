<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { onClickOutside } from "@vueuse/core";

/**
 * sun-panel 风格取色器：整行色条（棋盘格衬底显透明）+ 点击弹出
 * 渐变面板 / 色相条 / 透明度条 / HEXA 输入 / 预设色板。
 * - modelValue 为空 = 跟随卡片默认（色条显示占位文字）
 * - 选色后恒输出 8 位 #RRGGBBAA（不会与旧数据 6 位格式混淆）
 * - 透明度拉到 0 或点预设里的"透明"格 = 清除（回到跟随默认）
 */
const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();

const rootRef = ref<HTMLElement | null>(null);
const open = ref(false);
const popStyle = ref<Record<string, string>>({});
const hsv = ref({ h: 0, s: 0, v: 1, a: 1 });
const hexInput = ref("");

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function hexToHsv(input: string): { h: number; s: number; v: number; a: number } {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(input.trim());
  if (!m) return { h: 0, s: 0, v: 1, a: 1 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const a = m[2] ? parseInt(m[2], 16) / 255 : 1;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max, a };
}

function hsvToHex(c = hsv.value): string {
  const f = (n: number) => {
    const k = (n + c.h / 60) % 6;
    const x = c.v - c.v * c.s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(x * 255);
  };
  const hx = (x: number) => x.toString(16).padStart(2, "0").toUpperCase();
  return `#${hx(f(5))}${hx(f(3))}${hx(f(1))}${hx(Math.round(c.a * 255))}`;
}

function emitCurrent() {
  emit("update:modelValue", hsv.value.a <= 0 ? "" : hsvToHex());
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) hsv.value = hexToHsv(v);
  },
  { immediate: true },
);

function toggle(e: MouseEvent) {
  if (open.value) {
    open.value = false;
    return;
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const W = 276;
  const H = 356;
  const left = clamp(rect.left, 8, window.innerWidth - W - 8);
  let top = rect.bottom + 6;
  if (top + H > window.innerHeight - 8) top = Math.max(8, rect.top - H - 6);
  popStyle.value = { left: `${left}px`, top: `${top}px`, width: `${W}px` };
  hexInput.value = props.modelValue || hsvToHex();
  open.value = true;
}
onClickOutside(rootRef, () => (open.value = false));

// ---- 拖拽选色（pointer capture 到 window，出面板也能继续拖） ----
function startDrag(e: PointerEvent, apply: (ev: PointerEvent) => void) {
  apply(e);
  const move = (ev: PointerEvent) => apply(ev);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

const svRef = ref<HTMLElement | null>(null);
const hueRef = ref<HTMLElement | null>(null);
const alphaRef = ref<HTMLElement | null>(null);

function onSvDown(e: PointerEvent) {
  const el = svRef.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  startDrag(e, (ev) => {
    hsv.value.s = clamp((ev.clientX - r.left) / r.width, 0, 1);
    hsv.value.v = clamp(1 - (ev.clientY - r.top) / r.height, 0, 1);
    emitCurrent();
  });
}
function onHueDown(e: PointerEvent) {
  const el = hueRef.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  startDrag(e, (ev) => {
    hsv.value.h = clamp((ev.clientX - r.left) / r.width, 0, 1) * 359.9;
    emitCurrent();
  });
}
function onAlphaDown(e: PointerEvent) {
  const el = alphaRef.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  startDrag(e, (ev) => {
    hsv.value.a = clamp((ev.clientX - r.left) / r.width, 0, 1);
    emitCurrent();
  });
}

function applyHexInput() {
  let t = hexInput.value.trim().replace("#", "");
  if (/^[0-9a-f]{3}$/i.test(t)) t = t.split("").map((c) => c + c).join("");
  if (/^[0-9a-f]{6}$/i.test(t)) t += "FF";
  if (/^[0-9a-f]{8}$/i.test(t)) {
    hsv.value = hexToHsv("#" + t);
    emitCurrent();
  }
}

const PRESETS = [
  { v: "", title: "透明（跟随卡片默认）" },
  { v: "#000000FF", title: "黑" },
  { v: "#FFFFFFFF", title: "白" },
  { v: "#22C55EFF", title: "绿" },
  { v: "#3B82F6FF", title: "蓝" },
  { v: "#F59E0BFF", title: "橙" },
  { v: "#EF4444FF", title: "红" },
  { v: "#A855F7FF", title: "紫" },
];

function applyPreset(v: string) {
  if (!v) {
    hsv.value = { ...hsv.value, a: 0 };
    emit("update:modelValue", "");
    return;
  }
  hsv.value = hexToHsv(v);
  emitCurrent();
}

// 色条文字：有颜色时白字+描边阴影（衬在色块上）；留空时灰字（衬在浅色棋盘格上）
const swatchTextStyle = computed(() =>
  props.modelValue
    ? "color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 3px rgba(0,0,0,.6)"
    : "color:#9ca3af",
);
</script>

<template>
  <div ref="rootRef" class="relative">
    <!-- 触发色条：棋盘格衬底 + 当前色覆盖 + 居中文字 -->
    <button
      type="button"
      class="sys-cp-swatch w-full h-9 rounded-lg border border-gray-200 relative overflow-hidden cursor-pointer hover:border-gray-900 transition-colors bg-white"
      :title="modelValue || '跟随卡片默认（点击选择颜色）'"
      @click="toggle"
    >
      <span class="absolute inset-0 sys-cp-checker"></span>
      <span
        v-if="modelValue"
        class="absolute inset-0"
        :style="{ backgroundColor: modelValue }"
      ></span>
      <span class="relative z-10 text-xs font-mono" :style="swatchTextStyle">
        {{ modelValue || "跟随卡片默认" }}
      </span>
    </button>

    <!-- 取色面板 -->
    <div
      v-if="open"
      class="fixed z-[120] bg-white border border-gray-200 rounded-xl shadow-2xl p-3 select-none"
      :style="popStyle"
    >
      <!-- 渐变面板 -->
      <div
        ref="svRef"
        class="relative w-full h-32 rounded-lg cursor-crosshair overflow-hidden"
        :style="{
          background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0)), hsl(${hsv.h}, 100%, 50%)`,
        }"
        @pointerdown.prevent="onSvDown"
      >
        <span
          class="absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.6)] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          :style="{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            backgroundColor: hsvToHex({ ...hsv, a: 1 }),
          }"
        ></span>
      </div>

      <!-- 色相条 -->
      <div
        ref="hueRef"
        class="relative w-full h-3 rounded-full mt-3 cursor-pointer sys-cp-hue"
        @pointerdown.prevent="onHueDown"
      >
        <span
          class="absolute top-1/2 w-4 h-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.6)] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          :style="{ left: `${(hsv.h / 359.9) * 100}%`, backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }"
        ></span>
      </div>

      <!-- 透明度条 -->
      <div
        ref="alphaRef"
        class="relative w-full h-3 rounded-full mt-2 cursor-pointer overflow-hidden"
        @pointerdown.prevent="onAlphaDown"
      >
        <span class="absolute inset-0 sys-cp-checker"></span>
        <span
          class="absolute inset-0"
          :style="{
            background: `linear-gradient(to right, transparent, hsl(${hsv.h}, 100%, 50%))`,
          }"
        ></span>
        <span
          class="absolute top-1/2 w-4 h-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.6)] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          :style="{
            left: `${hsv.a * 100}%`,
            backgroundColor: hsvToHex({ ...hsv, a: hsv.a }),
          }"
        ></span>
      </div>

      <!-- HEXA 输入 -->
      <div class="flex items-center gap-2 mt-3">
        <span class="text-xs text-gray-500 font-mono">HEXA</span>
        <input
          v-model="hexInput"
          type="text"
          spellcheck="false"
          class="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-mono text-gray-800 outline-none focus:border-gray-900 transition-colors"
          @keydown.enter="applyHexInput"
          @blur="applyHexInput"
        />
      </div>

      <!-- 预设色板 -->
      <div class="flex items-center gap-1.5 mt-3">
        <button
          v-for="p in PRESETS"
          :key="p.title"
          type="button"
          class="w-7 h-7 rounded-md border border-gray-300 relative overflow-hidden cursor-pointer hover:scale-110 transition-transform"
          :title="p.title"
          @click="applyPreset(p.v)"
        >
          <span class="absolute inset-0 sys-cp-checker"></span>
          <span
            v-if="p.v"
            class="absolute inset-0"
            :style="{ backgroundColor: p.v.slice(0, 7) }"
          ></span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 透明度棋盘格（灰白相间，衬出半透明色） */
.sys-cp-checker {
  background-image:
    linear-gradient(45deg, #c8c8c8 25%, transparent 25%),
    linear-gradient(-45deg, #c8c8c8 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #c8c8c8 75%),
    linear-gradient(-45deg, transparent 75%, #c8c8c8 75%);
  background-size: 10px 10px;
  background-position:
    0 0,
    0 5px,
    5px -5px,
    -5px 0;
  background-color: #efefef;
}
/* 色相条七段渐变 */
.sys-cp-hue {
  background: linear-gradient(
    to right,
    #f00 0%,
    #ff0 17%,
    #0f0 33%,
    #0ff 50%,
    #00f 67%,
    #f0f 83%,
    #f00 100%
  );
}
</style>
