import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAR_RATIO,
  DEFAULT_MIN_FONT_SIZE,
  ellipsizeMiddle,
  estimateTextWidth,
  fitIpAddress,
} from "./ipAddressFit";

/** 39 字符，最容易撑爆地址行的形态 */
const V6 = "240e:3a5:483b:5e40:808a:37ff:fe12:3456";
const V4 = "114.219.57.203";
/** 1×1 IP 卡片去边距、再去掉标签与间距后剩下的地址可用宽度 */
const TINY = 90;

describe("fitIpAddress", () => {
  it("空文本返回空", () => {
    const r = fitIpAddress({ text: "", availableWidth: 120, baseFontSize: 20 });
    expect(r.display).toBe("");
    expect(r.truncated).toBe(false);
  });

  it("宽度还没测到时不做任何降级（首帧）", () => {
    const zero = fitIpAddress({ text: V6, availableWidth: 0, baseFontSize: 20 });
    expect(zero.display).toBe(V6);
    expect(zero.fontSize).toBe(20);
    expect(zero.truncated).toBe(false);

    const nan = fitIpAddress({ text: V6, availableWidth: Number.NaN, baseFontSize: 20 });
    expect(nan.display).toBe(V6);

    const negative = fitIpAddress({ text: V6, availableWidth: -5, baseFontSize: 20 });
    expect(negative.display).toBe(V6);
  });

  it("容器够宽时用基准字号完整显示", () => {
    const r = fitIpAddress({ text: V4, availableWidth: 200, baseFontSize: 20 });
    expect(r.display).toBe(V4);
    expect(r.fontSize).toBe(20);
    expect(r.truncated).toBe(false);
  });

  it("IPv4 在小卡片里靠缩字号保持完整", () => {
    const r = fitIpAddress({ text: V4, availableWidth: TINY, baseFontSize: 20 });
    expect(r.display).toBe(V4);
    expect(r.truncated).toBe(false);
    expect(r.fontSize).toBe(DEFAULT_MIN_FONT_SIZE);
  });

  it("IPv6 在小卡片里按段边界中段省略，不再从字符中间撕开", () => {
    const r = fitIpAddress({ text: V6, availableWidth: TINY, baseFontSize: 20 });
    expect(r.display).toBe("240e:3a5:…3456");
    expect(r.fontSize).toBe(DEFAULT_MIN_FONT_SIZE);
    expect(r.truncated).toBe(true);
    expect(r.display.length).toBeLessThan(V6.length);
  });

  it("地址行偏窄时（来源行）省略更狠但仍是完整段", () => {
    // 来源行标签更小、可用宽度略大，预算够到 15 字符
    const r = fitIpAddress({ text: V6, availableWidth: 94, baseFontSize: 14 });
    expect(r.truncated).toBe(true);
    expect(r.display.startsWith("240e:")).toBe(true);
    expect(r.display.endsWith("3456")).toBe(true);
    expect(r.display).toContain("…");
  });

  it("字号永远不超过基准字号，也不低于最小字号", () => {
    for (let w = 20; w <= 500; w += 7) {
      const r = fitIpAddress({ text: V6, availableWidth: w, baseFontSize: 20 });
      expect(r.fontSize).toBeLessThanOrEqual(20);
      expect(r.fontSize).toBeGreaterThanOrEqual(DEFAULT_MIN_FONT_SIZE);
    }
  });

  it("基准字号低于最小字号时被抬到最小字号", () => {
    const r = fitIpAddress({ text: V4, availableWidth: 400, baseFontSize: 6, minFontSize: 10 });
    expect(r.fontSize).toBe(10);
  });

  it("可自定义最小字号与字符宽高比", () => {
    const r = fitIpAddress({ text: V4, availableWidth: TINY, baseFontSize: 20, minFontSize: 14 });
    expect(r.fontSize).toBe(14);
    expect(r.truncated).toBe(true);
    // 14px 下 14 个字符需要 121.5px，90px 放不下 → 必须省略
    expect(estimateTextWidth(r.display, r.fontSize, DEFAULT_CHAR_RATIO)).toBeLessThanOrEqual(TINY);

    const wide = fitIpAddress({ text: V4, availableWidth: TINY, baseFontSize: 20, charRatio: 0.5 });
    expect(wide.fontSize).toBeGreaterThan(DEFAULT_MIN_FONT_SIZE);
  });

  it("任何宽度下都不溢出，且结果永不含空白字符（绝不换行）", () => {
    const texts = [V4, V6, "10.0.0.1", "fe80::1", "2001:db8::1", "very-long-host.example.com"];
    for (const text of texts) {
      for (let w = 16; w <= 400; w += 2) {
        const r = fitIpAddress({ text, availableWidth: w, baseFontSize: 20 });
        expect(r.display).not.toMatch(/\s/);
        expect(r.display.length).toBeGreaterThan(0);
        expect(estimateTextWidth(r.display, r.fontSize)).toBeLessThanOrEqual(w + 0.001);
      }
    }
  });
});

describe("ellipsizeMiddle", () => {
  it("预算足够时原样返回", () => {
    expect(ellipsizeMiddle(V6, V6.length)).toBe(V6);
    expect(ellipsizeMiddle(V6, 60)).toBe(V6);
  });

  it("按冒号段边界切，头尾都是完整段", () => {
    const r = ellipsizeMiddle(V6, 14);
    expect(r).toBe("240e:3a5:…3456");
    expect(r.startsWith("240e:3a5:")).toBe(true);
    expect(r.endsWith("3456")).toBe(true);
  });

  it("优先保留更多头部段（IPv6 前半是网络前缀）", () => {
    expect(ellipsizeMiddle(V6, 20)).toBe("240e:3a5:483b:…3456");
  });

  it("按点分段处理 IPv4", () => {
    expect(ellipsizeMiddle(V4, 8)).toBe("114.…203");
  });

  it("无分隔符时头尾等分", () => {
    expect(ellipsizeMiddle("abcdefghij", 6)).toBe("abc…ij");
  });

  it("预算极小时只留头部或省略号", () => {
    expect(ellipsizeMiddle(V6, 2)).toBe("2…");
    expect(ellipsizeMiddle(V6, 1)).toBe("…");
    expect(ellipsizeMiddle(V6, 0)).toBe("");
  });
});

describe("estimateTextWidth", () => {
  it("按字符数 × 宽高比 × 字号估算", () => {
    expect(estimateTextWidth("abcd", 10, 0.6)).toBeCloseTo(24, 5);
    expect(estimateTextWidth("", 10)).toBe(0);
    expect(estimateTextWidth("abcd", 10)).toBeCloseTo(4 * DEFAULT_CHAR_RATIO * 10, 5);
  });
});
