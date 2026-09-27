import { describe, it, expect } from "vitest";
import {
  computeSizePopoverPlacement,
  HANDLE_GAP,
  HANDLE_INSET,
  HANDLE_SIZE,
} from "./sizePopoverPlacement";

/**
 * 数字全部来自真机实测（1080×758 视口、默认 4 列网格）：
 *   1 列 1 行卡片 210×140，尺寸面板 224×345。
 * 修之前面板固定在卡片底边上方 48px，首行卡片实测顶部 −39px 被裁。
 */
const CARD = { top: 214, left: 83.5, right: 293.5, bottom: 354, width: 210, height: 140 };
const HANDLE = { top: 314, left: 253.5, right: 285.5, bottom: 346, width: 32, height: 32 };
const PANEL = { panelWidth: 224, panelHeight: 345 };
const VP = { viewportWidth: 1080, viewportHeight: 758 };

const rect = (top: number, left: number, width: number, height: number) => ({
  top,
  left,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

describe("computeSizePopoverPlacement", () => {
  it("首行卡片：上方放不下 → 翻到把手下沿，面板完整落在视口内且不压住把手", () => {
    const p = computeSizePopoverPlacement({ cardRect: CARD, handleRect: HANDLE, ...PANEL, ...VP });

    expect(p.flippedY).toBe(true);
    // 视口坐标：把手**下沿** 346 → 面板顶边翻到 346 + gap（贴下沿才不会盖住把手）
    expect(p.viewportTop).toBe(HANDLE.bottom + HANDLE_GAP);
    expect(p.viewportTop).toBeGreaterThanOrEqual(HANDLE.bottom);
    expect(p.viewportTop).toBeGreaterThanOrEqual(8);
    expect(p.viewportTop + PANEL.panelHeight).toBeLessThanOrEqual(VP.viewportHeight - 8);
    // 卡片内相对坐标（面板挂在卡片里，卡片由 transform 定位）
    expect(p.top).toBe(Math.round(HANDLE.bottom + HANDLE_GAP - CARD.top));
    expect(p.left).toBe(Math.round(HANDLE.right - PANEL.panelWidth - CARD.left));
    expect(p.scrollableY).toBe(false);
    expect(p.maxHeight).toBe(PANEL.panelHeight);
  });

  it("第二行卡片：上方放得下时落位与老写法（卡片底边 − 48px）完全一致", () => {
    const card = rect(378, 83.5, 210, 140);
    const handle = rect(478, 253.5, 32, 32);
    const p = computeSizePopoverPlacement({ cardRect: card, handleRect: handle, ...PANEL, ...VP });

    const oldTop = card.bottom - 48 - PANEL.panelHeight; // 老实现：bottom-12 往上长
    expect(p.flippedY).toBe(false);
    expect(p.viewportTop).toBe(oldTop);
    expect(p.top).toBe(oldTop - card.top);
  });

  it("量不到把手时按卡片右下角内缩 8px、把手 32×32 推算，结果不变", () => {
    const withHandle = computeSizePopoverPlacement({ cardRect: CARD, handleRect: HANDLE, ...PANEL, ...VP });
    const without = computeSizePopoverPlacement({ cardRect: CARD, handleRect: null, ...PANEL, ...VP });

    expect(HANDLE.top).toBe(CARD.bottom - HANDLE_INSET - HANDLE_SIZE);
    expect(HANDLE.right).toBe(CARD.right - HANDLE_INSET);
    expect(without).toEqual(withHandle);
  });

  it("面板比视口还高时夹进视口并允许内部滚动", () => {
    const p = computeSizePopoverPlacement({
      cardRect: CARD,
      handleRect: HANDLE,
      panelWidth: 224,
      panelHeight: 900,
      viewportWidth: 1080,
      viewportHeight: 500,
    });

    expect(p.scrollableY).toBe(true);
    expect(p.maxHeight).toBe(500 - 16);
    expect(p.viewportTop).toBe(8);
    expect(p.top).toBe(8 - CARD.top); // 夹在视口顶 → 卡片内坐标要减掉卡片原点
  });

  it("卡片贴着屏幕左边时，面板翻到把手右侧而不是伸到屏幕外", () => {
    const card = rect(214, 0, 210, 140);
    const handle = rect(314, 170, 32, 32); // right = 202
    const p = computeSizePopoverPlacement({ cardRect: card, handleRect: handle, ...PANEL, ...VP });

    expect(p.scrollableX).toBe(false);
    expect(p.viewportLeft).toBeGreaterThanOrEqual(8);
    expect(p.viewportLeft + PANEL.panelWidth).toBeLessThanOrEqual(VP.viewportWidth - 8);
  });

  it("宽卡片：面板右边缘对齐把手右边缘（与老写法 right-2 视觉一致）", () => {
    const card = rect(378, 83.5, 1091, 304);
    const handle = rect(626, 1134.5, 32, 32); // bottom-2 right-2
    const p = computeSizePopoverPlacement({
      cardRect: card,
      handleRect: handle,
      ...PANEL,
      viewportWidth: 1280,
      viewportHeight: 900,
    });

    expect(p.viewportLeft + PANEL.panelWidth).toBeCloseTo(handle.right, 5);
    expect(p.viewportLeft).toBe(handle.right - PANEL.panelWidth);
  });

  it("穷举卡片位置 × 面板尺寸：面板恒在视口内", () => {
    const viewports = [
      { viewportWidth: 1080, viewportHeight: 758 },
      { viewportWidth: 390, viewportHeight: 667 },
      { viewportWidth: 1440, viewportHeight: 900 },
      { viewportWidth: 1080, viewportHeight: 300 },
    ];
    const panels = [
      { panelWidth: 224, panelHeight: 345 },
      { panelWidth: 260, panelHeight: 520 },
      { panelWidth: 224, panelHeight: 2000 },
    ];
    for (const vp of viewports) {
      for (const panel of panels) {
        for (const cardTop of [-200, 0, 100, 214, 600, 1200]) {
          for (const cardLeft of [-100, 0, 83.5, 800, 1400]) {
            const card = rect(cardTop, cardLeft, 210, 140);
            const handle = rect(
              cardTop + 100,
              cardLeft + 170,
              HANDLE_SIZE,
              HANDLE_SIZE,
            );
            const p = computeSizePopoverPlacement({ cardRect: card, handleRect: handle, ...panel, ...vp });
            const w = Math.min(panel.panelWidth, vp.viewportWidth - 16);
            const h = Math.min(panel.panelHeight, vp.viewportHeight - 16);
            const label = `card=(${cardLeft},${cardTop}) panel=${panel.panelWidth}x${panel.panelHeight} vp=${vp.viewportWidth}x${vp.viewportHeight}`;

            expect(p.viewportTop, label).toBeGreaterThanOrEqual(8);
            expect(p.viewportLeft, label).toBeGreaterThanOrEqual(8);
            expect(p.viewportTop + h, label).toBeLessThanOrEqual(vp.viewportHeight - 8);
            expect(p.viewportLeft + w, label).toBeLessThanOrEqual(vp.viewportWidth - 8);
            // 卡片内相对坐标 = 视口坐标 − 卡片原点（父子同处一个平移坐标系）
            expect(p.top, label).toBe(Math.round(p.viewportTop - card.top));
            expect(p.left, label).toBe(Math.round(p.viewportLeft - card.left));
          }
        }
      }
    }
  });
});
