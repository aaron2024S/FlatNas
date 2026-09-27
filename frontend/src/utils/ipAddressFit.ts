/**
 * IP 地址在固定宽度容器里的自适应显示。
 *
 * 背景：IP 卡片的地址行是「标签 + 地址」的 flex 横排。完整 IPv6 有 39 个字符，
 * 而 1×1 卡片去边距后只有 100 出头像素可用，于是出现两个崩坏：
 *   1. 标签没有 shrink-0 / nowrap，被长地址挤到不足一个字宽，「外网」竖排；
 *   2. 地址用 break-all，被从字符中间硬撕成两行。
 *
 * 这里只负责「给定文本与可用宽度，算出该用什么字号、该显示成什么」，纯函数、不碰 DOM。
 * 标签防挤压由组件的 shrink-0 + whitespace-nowrap 保证，不在这里处理。
 *
 * 策略（按优先级降级）：
 *   1. 基准字号放得下 → 原样完整显示；
 *   2. 缩字号（下限 minFontSize）后放得下 → 完整显示，字号缩小；
 *   3. 缩到下限仍放不下 → 中段省略，按 `:` / `.` 段边界切，头尾都保留。
 * 三条路径都不会产生换行，所以调用方必须配合 white-space: nowrap + overflow: hidden。
 */

/**
 * 等宽字体「单字符宽度 / 字号」。
 *
 * 真机实测（本机 Edge + 项目字体）数字与冒号约 0.55，这里取 0.62 留约 12% 余量 ——
 * 估得偏宽只会让地址更早省略，估得偏窄却会让文字被 overflow-hidden 裁掉半个字符，
 * 所以宁可保守。换平台/换等宽字体时不用调这个值。
 */
export const DEFAULT_CHAR_RATIO = 0.62;

/** 地址允许缩到的最小字号。低于这个值数字开始难认。 */
export const DEFAULT_MIN_FONT_SIZE = 10;

const ELLIPSIS = "…";

export interface IpFitInput {
  /** 要显示的地址文本（IPv4 / IPv6 / 域名均可） */
  text: string;
  /** 地址实际可用宽度（px）。传 0 或非有限值表示尚未测量（首帧），此时不做任何降级 */
  availableWidth: number;
  /** 期望字号（px），放得下就用它 */
  baseFontSize: number;
  /** 允许缩到的最小字号，默认 {@link DEFAULT_MIN_FONT_SIZE} */
  minFontSize?: number;
  /** 等宽字符宽高比，默认 {@link DEFAULT_CHAR_RATIO} */
  charRatio?: number;
}

export interface IpFitResult {
  /** 最终显示的文本，保证不含空白字符（永不换行） */
  display: string;
  /** 最终字号（px） */
  fontSize: number;
  /** 是否发生了省略 */
  truncated: boolean;
}

/** 按给定字号估算文本像素宽度 */
export function estimateTextWidth(text: string, fontSize: number, charRatio = DEFAULT_CHAR_RATIO): number {
  return text.length * charRatio * fontSize;
}

/**
 * 中段省略：保留头部与尾部，中间换成 `…`。
 *
 * 有分隔符时按段边界切（IPv6 的 `:`、IPv4 的 `.`），这样每一段都是完整的，
 * 比从字符中间撕开可读得多。同一 head 段数下优先保留更多尾部段；
 * 不同 head 段数之间优先保留更多 head 段（IPv6 前半是网络前缀，更常被用来认网段）。
 */
export function ellipsizeMiddle(text: string, budget: number): string {
  if (budget <= 0) return "";
  if (text.length <= budget) return text;
  if (budget <= 1) return ELLIPSIS;

  const sep = text.includes(":") ? ":" : text.includes(".") ? "." : "";
  const segments = sep ? text.split(sep) : [];

  if (segments.length >= 2) {
    let best: string | null = null;
    let bestHead = 0;
    for (let head = segments.length - 1; head >= 1; head--) {
      for (let tail = 1; head + tail <= segments.length; tail++) {
        // 头部各段自带分隔符（`240e:3a5:`），省略号后直接接尾段（`…3456`）——
        // 这样每个字符都用在信息上，比两侧都补分隔符多保留一段前缀。
        const candidate =
          segments.slice(0, head).join(sep) + sep + ELLIPSIS + segments.slice(segments.length - tail).join(sep);
        if (candidate.length > budget) continue;
        if (head > bestHead || (head === bestHead && candidate.length > (best?.length ?? 0))) {
          best = candidate;
          bestHead = head;
        }
      }
    }
    if (best) return best;
    // 连「头一段 + … + 尾一段」都塞不下，退化为只留头部
    return segments[0].slice(0, budget - 1) + ELLIPSIS;
  }

  // 没有分隔符（或只有一段）：头尾等分
  const keep = budget - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return text.slice(0, head) + ELLIPSIS + (tail > 0 ? text.slice(text.length - tail) : "");
}

/**
 * 计算地址该用什么字号、显示成什么。
 *
 * 不变式：返回值满足 `estimateTextWidth(display, fontSize) <= availableWidth`
 * （availableWidth <= 0 的首帧分支除外），因此调用方不会出现横向溢出。
 */
export function fitIpAddress(input: IpFitInput): IpFitResult {
  const text = String(input?.text ?? "").trim();
  const rawRatio = Number(input?.charRatio);
  const ratio = Number.isFinite(rawRatio) && rawRatio > 0 ? rawRatio : DEFAULT_CHAR_RATIO;
  const rawMin = Number(input?.minFontSize);
  const minFont = Number.isFinite(rawMin) && rawMin > 0 ? rawMin : DEFAULT_MIN_FONT_SIZE;
  const rawBase = Number(input?.baseFontSize);
  const baseFont = Number.isFinite(rawBase) ? Math.max(minFont, rawBase) : minFont;
  const available = Number(input?.availableWidth);

  if (!text) {
    return { display: "", fontSize: baseFont, truncated: false };
  }

  // 首帧还没量到宽度：原样返回，由容器的 overflow-hidden 兜住这一帧
  if (!Number.isFinite(available) || available <= 0) {
    return { display: text, fontSize: baseFont, truncated: false };
  }

  if (estimateTextWidth(text, baseFont, ratio) <= available) {
    return { display: text, fontSize: baseFont, truncated: false };
  }

  // 先试缩字号（按 0.5px 向下取整，避免尺寸抖动时字号频繁跳变）
  const scaled = Math.floor((available / (text.length * ratio)) * 2) / 2;
  if (scaled >= minFont && estimateTextWidth(text, scaled, ratio) <= available) {
    return { display: text, fontSize: scaled, truncated: false };
  }

  // 缩到下限还放不下：中段省略
  const budget = Math.floor(available / (ratio * minFont));
  const display = ellipsizeMiddle(text, budget);
  return { display, fontSize: minFont, truncated: display !== text };
}
