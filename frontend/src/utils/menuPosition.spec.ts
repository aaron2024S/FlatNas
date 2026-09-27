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

// SizeSelector（编辑态「调整尺寸」面板）就是这套偏好的第一个用户：
// 锚点是卡片右下角把手，面板挂在它上方、右边缘对齐，实测 224×345。
describe("computeMenuPlacement · 方向偏好（preferY / preferX / gap）", () => {
  const VP = { viewportWidth: 1080, viewportHeight: 758 };
  const PANEL = { width: 224, height: 345 };
  // 首行 1×1 卡片：卡片 (83.5, 214) 210×140，把手右边缘 285.5、上沿 314、下沿 346
  const ANCHOR = { anchorX: 285.5, anchorY: 314 };
  // 翻到下方时改用把手下沿当锚点（否则面板会压住把手）
  const SIZE_PANEL = {
    ...VP,
    ...PANEL,
    ...ANCHOR,
    flipAnchorY: 346,
    gap: 8,
    preferY: "above",
    preferX: "left",
  } as const;

  it("上方放得下时，面板底边贴着锚点上沿留出 gap（与老写法 bottom-12 视觉一致）", () => {
    const anchorY = 700;
    const p = computeMenuPlacement({ ...SIZE_PANEL, anchorY });
    expect(p.flippedY).toBe(false);
    expect(p.top).toBe(anchorY - PANEL.height - 8);
  });

  it("上方放不下时翻到锚点下方（首行卡片就是这种），默认沿用原锚点", () => {
    const p = computeMenuPlacement({
      ...SIZE_PANEL,
      flipAnchorY: undefined,
    });
    expect(p.flippedY).toBe(true);
    expect(p.top).toBe(314 + 8);
  });

  it("给了 flipAnchorY 就按它落位：贴在把手**下沿**，不压住把手", () => {
    const p = computeMenuPlacement({ ...SIZE_PANEL });
    expect(p.flippedY).toBe(true);
    expect(p.top).toBe(346 + 8);
    expect(p.top).toBeGreaterThanOrEqual(346); // 整个面板在把手下沿之下
    expect(p.top + PANEL.height).toBeLessThanOrEqual(VP.viewportHeight - MENU_EDGE);
  });

  it("preferX=left：右边缘对齐锚点（等价于老的 right-2）", () => {
    const p = computeMenuPlacement({ ...SIZE_PANEL, anchorY: 700 });
    expect(p.flippedX).toBe(false);
    expect(p.left).toBe(285.5 - PANEL.width);
  });

  it("preferX=left：左边要出屏时翻到锚点右侧", () => {
    const anchorX = 30; // 卡片贴着左边，面板往左放不下
    const p = computeMenuPlacement({ ...SIZE_PANEL, anchorY: 700, anchorX });
    expect(p.flippedX).toBe(true);
    expect(p.left).toBe(anchorX);
  });

  it("上下都放不下（超矮视口）时夹进视口，不翻转也不出屏", () => {
    const p = computeMenuPlacement({
      ...SIZE_PANEL,
      viewportHeight: 400,
    });
    expect(p.flippedY).toBe(false);
    expect(p.top).toBe(MENU_EDGE);
    expect(p.top + PANEL.height).toBeLessThanOrEqual(400 - MENU_EDGE);
  });

  it("穷举：preferY=above + preferX=left 同样恒在视口内", () => {
    const viewports = [
      { viewportWidth: 1080, viewportHeight: 758 },
      { viewportWidth: 1440, viewportHeight: 900 },
      { viewportWidth: 390, viewportHeight: 667 },
      { viewportWidth: 1080, viewportHeight: 360 },
    ];
    for (const vp of viewports) {
      for (const anchorX of [-20, 0, 8, 200, 1000, 1090]) {
        for (const anchorY of [-20, 0, 8, 314, 700, 760]) {
          const p = computeMenuPlacement({
            ...vp,
            ...PANEL,
            anchorX,
            anchorY,
            gap: 8,
            preferY: "above",
            preferX: "left",
          });
          const height = Math.min(PANEL.height, vp.viewportHeight - MENU_EDGE * 2);
          const width = Math.min(PANEL.width, vp.viewportWidth - MENU_EDGE * 2);
          const label = `anchor=(${anchorX},${anchorY}) vp=${vp.viewportWidth}x${vp.viewportHeight}`;
          expect(p.top, label).toBeGreaterThanOrEqual(MENU_EDGE);
          expect(p.left, label).toBeGreaterThanOrEqual(MENU_EDGE);
          expect(p.top + height, label).toBeLessThanOrEqual(vp.viewportHeight - MENU_EDGE);
          expect(p.left + width, label).toBeLessThanOrEqual(vp.viewportWidth - MENU_EDGE);
        }
      }
    }
  });
});
