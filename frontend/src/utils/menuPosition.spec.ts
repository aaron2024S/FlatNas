import { describe, it, expect } from "vitest";
import { computeMenuPlacement, MENU_EDGE } from "./menuPosition";

// 真实菜单的实测尺寸：六项（内网访问 / 备用内网 / 停止容器 / 重启容器 / 编辑 / 删除）
// 约 160×216；这组数字就是原来 150×100 那个估值翻车的地方。
const MENU = { width: 160, height: 216 };
const VIEWPORT = { viewportWidth: 1200, viewportHeight: 800 };

describe("computeMenuPlacement", () => {
  it("下方放得下时贴着点击点往右下弹（默认行为保持不变）", () => {
    const p = computeMenuPlacement({
      anchorX: 100,
      anchorY: 120,
      ...MENU,
      ...VIEWPORT,
    });

    expect(p.left).toBe(100);
    expect(p.top).toBe(120);
    expect(p.flippedX).toBe(false);
    expect(p.flippedY).toBe(false);
    expect(p.scrollableY).toBe(false);
  });

  it("靠近屏幕下沿、下方放不下时翻到点击点上方，底边贴着光标", () => {
    const anchorY = 780; // 离下沿只剩 20px，塞不下 216px
    const p = computeMenuPlacement({
      anchorX: 100,
      anchorY,
      ...MENU,
      ...VIEWPORT,
    });

    expect(p.flippedY).toBe(true);
    expect(p.top).toBe(anchorY - MENU.height);
    // 整个菜单落在视口内（含安全间距）
    expect(p.top).toBeGreaterThanOrEqual(MENU_EDGE);
    expect(p.top + MENU.height).toBeLessThanOrEqual(VIEWPORT.viewportHeight - MENU_EDGE);
  });

  it("右侧放不下时翻到左侧", () => {
    const anchorX = 1180;
    const p = computeMenuPlacement({
      anchorX,
      anchorY: 100,
      ...MENU,
      ...VIEWPORT,
    });

    expect(p.flippedX).toBe(true);
    expect(p.left).toBe(anchorX - MENU.width);
    expect(p.left + MENU.width).toBeLessThanOrEqual(VIEWPORT.viewportWidth - MENU_EDGE);
  });

  it("上下都放不下（菜单比视口还高）时夹进视口并允许内部滚动", () => {
    const viewportHeight = 400;
    const p = computeMenuPlacement({
      anchorX: 100,
      anchorY: 392,
      width: 160,
      height: 600,
      viewportWidth: 1200,
      viewportHeight,
    });

    expect(p.scrollableY).toBe(true);
    expect(p.maxHeight).toBe(viewportHeight - MENU_EDGE * 2);
    expect(p.top).toBe(MENU_EDGE);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(viewportHeight - MENU_EDGE);
  });

  it("菜单比视口还宽时同样夹住并允许横向滚动", () => {
    const p = computeMenuPlacement({
      anchorX: 100,
      anchorY: 100,
      width: 2000,
      height: 216,
      ...VIEWPORT,
    });

    expect(p.scrollableX).toBe(true);
    expect(p.maxWidth).toBe(VIEWPORT.viewportWidth - MENU_EDGE * 2);
    expect(p.left).toBe(MENU_EDGE);
  });

  it("尺寸没超限时不下无谓的 max-* 限制", () => {
    const p = computeMenuPlacement({ anchorX: 10, anchorY: 10, ...MENU, ...VIEWPORT });
    expect(p.maxWidth).toBe(MENU.width);
    expect(p.maxHeight).toBe(MENU.height);
    expect(p.scrollableX).toBe(false);
    expect(p.scrollableY).toBe(false);
  });

  it("点击点在视口外（长按越界、负坐标）也不会把菜单推出屏幕", () => {
    for (const [anchorX, anchorY] of [
      [-50, -20],
      [5000, 5000],
      [0, 800],
      [1200, 0],
    ]) {
      const p = computeMenuPlacement({ anchorX, anchorY, ...MENU, ...VIEWPORT });
      expect(p.left).toBeGreaterThanOrEqual(MENU_EDGE);
      expect(p.top).toBeGreaterThanOrEqual(MENU_EDGE);
      expect(p.left + MENU.width).toBeLessThanOrEqual(VIEWPORT.viewportWidth - MENU_EDGE);
      expect(p.top + MENU.height).toBeLessThanOrEqual(VIEWPORT.viewportHeight - MENU_EDGE);
    }
  });

  it("穷举点击点 × 菜单尺寸：结果恒在视口内（这是修好原 bug 的核心不变式）", () => {
    const viewports = [
      { viewportWidth: 1200, viewportHeight: 800 },
      { viewportWidth: 390, viewportHeight: 700 }, // 手机竖屏
      { viewportWidth: 720, viewportHeight: 360 }, // 手机横屏
    ];
    const anchors = [-10, 0, 8, 60, 200, 700, 1199, 1201];
    const sizes = [
      { width: 0, height: 0 },
      { width: 160, height: 216 },
      { width: 240, height: 320 },
      { width: 2000, height: 1500 },
      { width: 160, height: 900 },
    ];

    for (const vp of viewports) {
      for (const anchorX of anchors) {
        for (const anchorY of anchors) {
          for (const size of sizes) {
            const p = computeMenuPlacement({ anchorX, anchorY, ...size, ...vp });
            const width = Math.min(size.width, vp.viewportWidth - MENU_EDGE * 2);
            const height = Math.min(size.height, vp.viewportHeight - MENU_EDGE * 2);
            const label = `anchor=(${anchorX},${anchorY}) size=${size.width}x${size.height} vp=${vp.viewportWidth}x${vp.viewportHeight}`;

            expect(p.left, label).toBeGreaterThanOrEqual(MENU_EDGE);
            expect(p.top, label).toBeGreaterThanOrEqual(MENU_EDGE);
            expect(p.left + width, label).toBeLessThanOrEqual(
              vp.viewportWidth - MENU_EDGE,
            );
            expect(p.top + height, label).toBeLessThanOrEqual(
              vp.viewportHeight - MENU_EDGE,
            );
          }
        }
      }
    }
  });
});
