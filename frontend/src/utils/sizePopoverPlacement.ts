/**
 * 编辑态「调整尺寸」面板（SizeSelector）的落位。
 *
 * 面板 8×8 共 64 个格子，实测 **224×345**，比卡片本身高得多。原来它是写死的
 * `absolute bottom-12 right-2`：底边永远钉在卡片底边上方 48px，也就是**只能往上长**。
 * 首行卡片一打开，面板顶部就伸出视口顶（实测 −39px），标题行和首行格子直接被裁掉
 * ——页面根容器是 `overflow:hidden`，所以是真被裁，不是滚出去。
 *
 * 这里把落位规则交给通用的 computeMenuPlacement：
 *   preferY="above"  → 默认仍挂在把手上方（和原来视觉一致）
 *   上方放不下        → 翻到把手下沿 +8px
 *   上下都放不下      → 夹进视口，并让面板内部滚动
 *   preferX="left"   → 右边缘对齐把手（和原来的 right-2 视觉一致），
 *                      左边贴到屏幕外时再翻到把手的右侧
 *
 * 输出的是**卡片内相对坐标**：面板挂在卡片里，而卡片由 grid-layout-plus 用
 * `transform: translate(...)` 定位（`.vgl-item--transform`），父子同处一个平移坐标系，
 * 所以「视口坐标 − 卡片视口矩形」就是卡片内的偏移量。也因此不能用 position:fixed。
 */
import { computeMenuPlacement } from "./menuPosition";

export interface RectLike {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface SizePopoverInput {
  /** 卡片的视口矩形（也是面板的定位祖先） */
  cardRect: RectLike;
  /** 卡片右下角把手的视口矩形；量不到（jsdom / 首帧）时按卡片右下角推算 */
  handleRect?: RectLike | null;
  /** 面板的自然尺寸（渲染后量，别用被夹取过的高度） */
  panelWidth: number;
  panelHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface SizePopoverPlacement {
  /** 相对卡片左上角的偏移 */
  top: number;
  left: number;
  /** 面板尺寸上限：被夹取时靠它逼出内部滚动 */
  maxWidth: number;
  maxHeight: number;
  scrollableX: boolean;
  scrollableY: boolean;
  flippedY: boolean;
  /** 面板在视口里的落位，方便断言与调试 */
  viewportTop: number;
  viewportLeft: number;
}

/** 面板与把手上沿之间的间距（原来 bottom-12 恰好就是这个视觉间距） */
export const HANDLE_GAP = 8;
/** 把手的尺寸：w-8 h-8 */
export const HANDLE_SIZE = 32;
/** 把手距卡片右边 / 下边的距离：right-2 bottom-2 */
export const HANDLE_INSET = 8;

export function computeSizePopoverPlacement(
  input: SizePopoverInput,
): SizePopoverPlacement {
  const card = input.cardRect;
  // 量不到把手就按「卡片右下角内缩 8px、把手 32×32」推算
  const anchorX = input.handleRect
    ? input.handleRect.right
    : card.right - HANDLE_INSET;
  // 挂在把手上方时贴它的上沿
  const handleTop = input.handleRect
    ? input.handleRect.top
    : card.bottom - HANDLE_INSET - HANDLE_SIZE;
  // 翻到下方时贴它的下沿，免得面板把把手本身盖住
  const handleBottom = input.handleRect
    ? input.handleRect.bottom
    : card.bottom - HANDLE_INSET;

  const p = computeMenuPlacement({
    anchorX,
    anchorY: handleTop,
    flipAnchorY: handleBottom,
    width: input.panelWidth,
    height: input.panelHeight,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    gap: HANDLE_GAP,
    preferY: "above",
    preferX: "left",
  });

  return {
    top: Math.round(p.top - card.top),
    left: Math.round(p.left - card.left),
    maxWidth: Math.round(p.maxWidth),
    maxHeight: Math.round(p.maxHeight),
    scrollableX: p.scrollableX,
    scrollableY: p.scrollableY,
    flippedY: p.flippedY,
    viewportTop: p.top,
    viewportLeft: p.left,
  };
}
