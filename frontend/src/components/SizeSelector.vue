<template>
  <div
    ref="panelRef"
    class="absolute bg-white rounded-xl shadow-xl border border-gray-200 p-3 z-[9999] w-56 overlay-motion-static-popover"
    :style="panelStyle"
    @click.stop
    @mousedown.stop
    @touchstart.stop
    @pointerdown.stop
  >
    <div class="mb-2 text-xs font-bold text-gray-500 flex justify-between items-center">
      <span>调整尺寸</span>
      <span class="text-blue-600">{{ formatSize(currentCols) }} x {{ formatSize(currentRows) }}</span>
    </div>
    <div class="grid grid-cols-8 gap-1.5" @mouseleave="hoverIndex = null">
      <div
        v-for="i in 64"
        :key="i"
        class="w-5 h-5 rounded-md border-2 transition-all cursor-pointer"
        :class="getCellClass(i)"
        @mouseenter="hoverIndex = i"
        @click="selectSize(i)"
      ></div>
    </div>
    <div class="mt-2 text-[10px] text-gray-400 text-center">
      点击选择网格大小
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { computeSizePopoverPlacement } from '@/utils/sizePopoverPlacement'

const props = defineProps<{
  currentCol?: number
  currentRow?: number
}>()

const emit = defineEmits(['select'])

const hoverIndex = ref<number | null>(null)

const getSize = (i: number) => {
  const r = Math.ceil(i / 8)
  const c = ((i - 1) % 8) + 1
  return { c: c / 2, r: r / 2 }
}

const currentCols = computed(() => {
  if (hoverIndex.value !== null) {
    return getSize(hoverIndex.value).c
  }
  return props.currentCol || 1
})

const currentRows = computed(() => {
  if (hoverIndex.value !== null) {
    return getSize(hoverIndex.value).r
  }
  return props.currentRow || 1
})

const getCellClass = (i: number) => {
  const { c, r } = getSize(i)
  const targetC = currentCols.value
  const targetR = currentRows.value

  if (c <= targetC && r <= targetR) {
    return 'bg-blue-500 border-blue-600 scale-105'
  }
  return 'bg-gray-50 border-gray-200 hover:bg-blue-50 hover:border-blue-200'
}

const selectSize = (i: number) => {
  const { c, r } = getSize(i)
  emit('select', { colSpan: c, rowSpan: r })
}

const formatSize = (value: number) => {
  if (Number.isInteger(value)) return value.toString()
  return value.toFixed(1)
}

// ---- 贴边落位 ----
// 面板比卡片高得多（实测 224×345），底边钉在把手上方时，首行卡片一打开顶部就伸出
// 视口。这里改成「先渲染、量尺寸，再算落位」：上方放不下就翻到把手下方。
const panelRef = ref<HTMLElement | null>(null)
/** 首帧先藏起来，量完再显形（同在 onMounted 里同步完成，浏览器不会绘出中间态） */
const panelStyle = ref<Record<string, string>>({ visibility: 'hidden' })
let frameId = 0

/** 量自然尺寸：先把上限清掉，否则量到的是上一次夹取后的高度，永远「刚好放得下」 */
const measurePanel = (panel: HTMLElement) => {
  const prevMaxHeight = panel.style.maxHeight
  const prevOverflowY = panel.style.overflowY
  panel.style.maxHeight = 'none'
  panel.style.overflowY = 'visible'
  const width = panel.offsetWidth
  const height = panel.offsetHeight
  panel.style.maxHeight = prevMaxHeight
  panel.style.overflowY = prevOverflowY
  return { width, height }
}

const place = () => {
  const panel = panelRef.value
  if (!panel) return
  // 面板的定位祖先就是卡片（grid item）
  const card =
    (panel.offsetParent as HTMLElement | null) || panel.parentElement
  if (!card || typeof window === 'undefined') {
    // 极端兜底：拿不到卡片就退回老写法（贴在把手上方），至少别让面板消失
    panelStyle.value = { visibility: 'visible', bottom: '3rem', right: '0.5rem' }
    return
  }

  const handle = card.querySelector<HTMLElement>('.widget-drag-handle')
  const { width, height } = measurePanel(panel)
  const p = computeSizePopoverPlacement({
    cardRect: card.getBoundingClientRect(),
    handleRect: handle ? handle.getBoundingClientRect() : null,
    panelWidth: width,
    panelHeight: height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  })

  panelStyle.value = {
    top: `${p.top}px`,
    left: `${p.left}px`,
    maxWidth: `${p.maxWidth}px`,
    maxHeight: `${p.maxHeight}px`,
    overflowX: p.scrollableX ? 'auto' : 'visible',
    overflowY: p.scrollableY ? 'auto' : 'visible',
    visibility: 'visible',
  }
}

/** 窗口缩放 / 页面滚动都可能让已经摆好的面板又出界，重新算一次（rAF 合并抖动） */
const schedulePlace = () => {
  if (typeof window === 'undefined') return
  if (typeof window.requestAnimationFrame !== 'function') {
    place()
    return
  }
  if (frameId) return
  frameId = window.requestAnimationFrame(() => {
    frameId = 0
    place()
  })
}

onMounted(() => {
  place()
  window.addEventListener('resize', schedulePlace)
  // capture：滚动可能发生在任意一层可滚动祖先上，普通监听收不到
  window.addEventListener('scroll', schedulePlace, true)
})

onUnmounted(() => {
  window.removeEventListener('resize', schedulePlace)
  window.removeEventListener('scroll', schedulePlace, true)
  if (frameId && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(frameId)
    frameId = 0
  }
})
</script>
