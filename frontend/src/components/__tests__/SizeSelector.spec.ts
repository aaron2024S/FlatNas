import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import SizeSelector from "../SizeSelector.vue";

/**
 * jsdom 没有布局引擎：getBoundingClientRect 全是 0、offsetWidth 也是 0。
 * 这里按类名喂真机实测过的几何（1080×758 视口、1 列 1 行卡片 210×140、面板 224×345），
 * 让「先渲染后定位」那条路真的走一遍。
 *
 * 两点必须注意（踩过）：
 *   1. 组件要挂在**真正的卡片**下（所以用宿主组件包一层），VTU 的 attachTo 会多套一层 div；
 *   2. panelStyle 是响应式赋值，DOM 上的 style 要等一个 tick 才更新，断言前必须 nextTick。
 */
const CARD = { x: 83.5, y: 214, w: 210, h: 140 };
const PANEL_W = 224;
const PANEL_H = 345;

const rectOf = (x: number, y: number, w: number, h: number) => ({
  x,
  y,
  top: y,
  left: x,
  right: x + w,
  bottom: y + h,
  width: w,
  height: h,
  toJSON: () => ({}),
});

/** 按类名区分：卡片 / 把手 / 面板，模拟真实布局 */
let cardBox = { ...CARD };
const nativeRect = HTMLElement.prototype.getBoundingClientRect;

const Host = defineComponent({
  components: { SizeSelector },
  template: `
    <div class="rounded-2xl relative">
      <button class="widget-drag-handle"></button>
      <SizeSelector :current-col="1" :current-row="1" />
    </div>
  `,
});

beforeEach(() => {
  vi.stubGlobal("innerWidth", 1080);
  vi.stubGlobal("innerHeight", 758);
  cardBox = { ...CARD };

  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const cls = String(this.className || "");
    if (cls.includes("widget-drag-handle")) {
      // 把手：bottom-2 right-2、32×32
      return rectOf(
        cardBox.x + cardBox.w - 8 - 32,
        cardBox.y + cardBox.h - 8 - 32,
        32,
        32,
      ) as unknown as DOMRect;
    }
    if (cls.includes("rounded-2xl")) {
      return rectOf(cardBox.x, cardBox.y, cardBox.w, cardBox.h) as unknown as DOMRect;
    }
    return nativeRect.call(this) as DOMRect;
  };

  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains("overlay-motion-static-popover") ? PANEL_W : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains("overlay-motion-static-popover") ? PANEL_H : 0;
    },
  });
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = nativeRect;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const mountPanel = async () => {
  const wrapper = mount(Host, { attachTo: document.body });
  await nextTick();
  return wrapper;
};

const styleOf = (wrapper: ReturnType<typeof mount<typeof Host>>) =>
  wrapper.find(".overlay-motion-static-popover").attributes("style") || "";

const readStyle = (style: string, prop: string) =>
  Number(new RegExp(`${prop}: (-?[\\d.]+)px`).exec(style)?.[1] ?? "NaN");

describe("SizeSelector 落位", () => {
  it("首行卡片：上方放不下 → 面板翻到把手下沿，且不再写死 bottom/right", async () => {
    const wrapper = await mountPanel();
    const style = styleOf(wrapper);

    // 视口坐标：把手**下沿** 346 + gap 8 = 354 → 卡片内 354 − 214 = 140
    expect(readStyle(style, "top")).toBe(140);
    // 右边缘对齐把手：285.5 − 224 = 61.5 → 卡片内 61.5 − 83.5 = −22
    expect(readStyle(style, "left")).toBe(-22);
    expect(style).toContain("max-height: 345px");
    expect(style).not.toContain("bottom:");
    expect(style).toContain("visibility: visible");
  });

  it("上方有空间的高卡片：底边仍贴在把手上沿（与老写法 bottom-12 视觉一致）", async () => {
    cardBox = { ...CARD, h: 304 };
    const wrapper = await mountPanel();
    const style = styleOf(wrapper);

    // 把手顶边 = 214 + 304 − 40 = 478 → 面板顶边 478 − 345 − 8 = 125 → 卡片内 −89
    expect(readStyle(style, "top")).toBe(-89);
    expect(style).toContain("visibility: visible");
  });

  it("回归保护：根节点不能再挂 bottom-12 / right-2（会和算出来的 top/left 打架）", async () => {
    const wrapper = await mountPanel();
    const cls = wrapper.find(".overlay-motion-static-popover").classes().join(" ");

    expect(cls).not.toContain("bottom-12");
    expect(cls).not.toContain("right-2");
    expect(cls).toContain("absolute");
  });

  it("布局变化后重新落位（窗口缩放 / 页面滚动都会重算）", async () => {
    const wrapper = await mountPanel();
    expect(readStyle(styleOf(wrapper), "top")).toBe(140); // 首行：翻到把手下沿

    // 卡片挪到屏幕中下部 → 上方又放得下了 → 应该改回「贴在把手上沿」
    cardBox = { x: 83.5, y: 300, w: 210, h: 140 };
    window.dispatchEvent(new Event("resize"));
    await new Promise((r) => setTimeout(r, 30));
    await nextTick();

    // 把手顶边 400 → 面板顶边 400 − 345 − 8 = 47 → 卡片内 47 − 300 = −253
    const style = styleOf(wrapper);
    expect(readStyle(style, "top")).toBe(-253);

    // 卡片内坐标换算回视口后，面板仍完整落在视口里
    const viewportLeft = readStyle(style, "left") + cardBox.x;
    expect(viewportLeft).toBeGreaterThanOrEqual(8);
    expect(viewportLeft + PANEL_W).toBeLessThanOrEqual(1080 - 8);
  });
});

describe("SizeSelector 交互（改动不该影响选择行为）", () => {
  it("点第 i 格按 8 列换算成尺寸并抛出 select", async () => {
    const wrapper = await mountPanel();
    const cells = wrapper.findAll(".grid > div");
    // emit 来自子组件，要拿子组件实例的 emitted
    const child = wrapper.findComponent(SizeSelector);

    expect(cells.length).toBe(64);
    await cells[0].trigger("click");
    expect(child.emitted("select")?.[0]).toEqual([{ colSpan: 0.5, rowSpan: 0.5 }]);

    await cells[11].trigger("click"); // 第 2 行第 4 列 → 2 × 1
    expect(child.emitted("select")?.[1]).toEqual([{ colSpan: 2, rowSpan: 1 }]);
  });

  it("悬浮时表头跟着预览尺寸", async () => {
    const wrapper = await mountPanel();
    expect(wrapper.text()).toContain("1 x 1");

    await wrapper.findAll(".grid > div")[11].trigger("mouseenter"); // 第 2 行第 4 列
    expect(wrapper.text()).toContain("2 x 1");
  });
});
