/**
 * 浮层（右键菜单 / 气泡）贴边定位。
 *
 * 背景：GridPanel 的卡片菜单原来靠"猜尺寸"——写死 150×100 再往左上挪一次。
 * 菜单真有六项（内网访问 / 备用内网 / 外网访问 / 停止容器 / 编辑 / 删除）时
 * 实测 200~300px 高，估出来的 100 根本不够，而且既不做夹取、也不看点击点上方
 * 到底有没有空间，于是靠近屏幕下沿的卡片一右键，菜单底部几项就直接伸到视口外，
 * 点不到也看不见。
 *
 * 这里的规则（尺寸一律用实测值，不用常数）：
 *   1) 优先方向放得下 → 就按优先方向贴住锚点（preferY/preferX 决定，默认「下 + 右」）；
 *   2) 优先方向放不下、对面放得下 → 翻到对面；
 *   3) 两边都放不下（面板比视口还高/宽）→ 夹进视口，并让面板自己内部滚动。
 *
 * 两种锚点偏好：
 *   - 右键菜单：贴光标往下/往右弹（preferY="below"、preferX="right"，默认）；
 *   - 卡片「调整尺寸」面板（SizeSelector）：挂在卡片的把手**上方**、右边缘对齐把手，
 *     所以用 preferY="above"、preferX="left"，配 gap 留出与把手的间距。
 *
 * 纯函数，不碰 DOM，方便单测；量尺寸与写样式由调用方负责。
 */

/** 与视口边缘保持的安全间距（px） */
export const MENU_EDGE = 8;

export interface MenuPlacementInput {
  /** 点击点，视口坐标（MouseEvent.clientX / clientY） */
  anchorX: number;
  anchorY: number;
  /** 菜单渲染后的自然尺寸（offsetWidth / offsetHeight） */
  width: number;
  height: number;
  /** 视口尺寸（window.innerWidth / innerHeight） */
  viewportWidth: number;
  viewportHeight: number;
  /** 安全间距，默认 MENU_EDGE */
  edge?: number;
  /** 面板与锚点之间额外留的间隙，默认 0（右键菜单就是贴着光标） */
  gap?: number;
  /**
   * 垂直优先方向。below（默认）：面板顶边贴锚点往下弹；
   * above：面板底边贴锚点往上弹（尺寸面板挂在把手正上方就是这种）。
   */
  preferY?: "below" | "above";
  /**
   * 水平优先方向。right（默认）：面板左边贴锚点往右弹；
   * left：面板右边贴锚点往左弹。
   */
  preferX?: "right" | "left";
  /**
   * 翻到「对面」时改用这个纵坐标当锚点。默认沿用 anchorY。
   * 尺寸面板翻到下方时传把手的**下沿**，面板才不会压住把手本身。
   */
  flipAnchorY?: number;
}

export interface MenuPlacement {
  left: number;
  top: number;
  /** 面板可用的最大宽高：菜单比视口大时，靠它逼出内部滚动 */
  maxWidth: number;
  maxHeight: number;
  /** 尺寸被压缩到了视口以内，需要内部滚动 */
  scrollableX: boolean;
  scrollableY: boolean;
  /** 为了留在视口内而向左 / 向上翻转 */
  flippedX: boolean;
  flippedY: boolean;
}

// 上界小于下界时（元素比视口还大）取上界，别把元素推成负数
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

export function computeMenuPlacement(input: MenuPlacementInput): MenuPlacement {
  const edge = input.edge ?? MENU_EDGE;
  const gap = input.gap ?? 0;
  const preferY = input.preferY ?? "below";
  const preferX = input.preferX ?? "right";
  const vw = Math.max(0, input.viewportWidth);
  const vh = Math.max(0, input.viewportHeight);
  // 视口里真正可用的区域（四边各留 edge 的呼吸位）
  const usableW = Math.max(0, vw - edge * 2);
  const usableH = Math.max(0, vh - edge * 2);

  const naturalW = Math.max(0, input.width);
  const naturalH = Math.max(0, input.height);
  const width = Math.min(naturalW, usableW);
  const height = Math.min(naturalH, usableH);

  // ---- 垂直：按优先方向贴锚点，放不下就翻到对面，都不行就夹住 ----
  const flipAnchorY = input.flipAnchorY ?? input.anchorY;
  let top: number;
  let flippedY = false;
  if (preferY === "above") {
    top = input.anchorY - height - gap;
    // 上方放不下 → 翻到锚点下方（只在下方确实塞得下时才翻，否则交给夹取）
    if (top < edge && flipAnchorY + gap + height <= vh - edge) {
      top = flipAnchorY + gap;
      flippedY = true;
    }
  } else {
    top = input.anchorY + gap;
    if (top + height + edge > vh && flipAnchorY - gap - height >= edge) {
      top = flipAnchorY - gap - height;
      flippedY = true;
    }
  }
  top = clamp(top, edge, vh - height - edge);

  // ---- 水平：同理，向右贴不上就翻到左，再不行就夹住 ----
  let left: number;
  let flippedX = false;
  if (preferX === "left") {
    left = input.anchorX - width;
    if (left < edge && input.anchorX + width <= vw - edge) {
      left = input.anchorX;
      flippedX = true;
    }
  } else {
    left = input.anchorX;
    if (left + width + edge > vw && input.anchorX - width >= edge) {
      left = input.anchorX - width;
      flippedX = true;
    }
  }
  left = clamp(left, edge, vw - width - edge);

  return {
    left,
    top,
    maxWidth: width,
    maxHeight: height,
    scrollableX: naturalW > usableW,
    scrollableY: naturalH > usableH,
    flippedX,
    flippedY,
  };
}
