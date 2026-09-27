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
 *   1) 下方放得下 → 贴着点击点往下弹（默认行为，保持不变）；
 *   2) 下方放不下、上方放得下 → 翻到点击点上方（菜单左下角贴着光标）；
 *   3) 上下都放不下（菜单比视口还高）→ 夹进视口，并让菜单自己内部滚动；
 *   4) 水平方向同理：右侧放不下就翻到左侧，再不行就夹住。
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
  const vw = Math.max(0, input.viewportWidth);
  const vh = Math.max(0, input.viewportHeight);
  // 视口里真正可用的区域（四边各留 edge 的呼吸位）
  const usableW = Math.max(0, vw - edge * 2);
  const usableH = Math.max(0, vh - edge * 2);

  const naturalW = Math.max(0, input.width);
  const naturalH = Math.max(0, input.height);
  const width = Math.min(naturalW, usableW);
  const height = Math.min(naturalH, usableH);

  // ---- 垂直：优先向下，其次向上，都不行就夹住 ----
  let top = input.anchorY;
  let flippedY = false;
  if (input.anchorY + height + edge > vh && input.anchorY - height >= edge) {
    top = input.anchorY - height;
    flippedY = true;
  }
  top = clamp(top, edge, vh - height - edge);

  // ---- 水平：优先向右，其次向左，都不行就夹住 ----
  let left = input.anchorX;
  let flippedX = false;
  if (input.anchorX + width + edge > vw && input.anchorX - width >= edge) {
    left = input.anchorX - width;
    flippedX = true;
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
