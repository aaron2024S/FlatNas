// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import IpAddressLine from "../base/IpAddressLine.vue";
import { fitIpAddress } from "@/utils/ipAddressFit";

const V6 = "240e:3a5:483b:5e40:808a:37ff:fe12:3456";

/** 与组件里写死的一致 —— 可用宽度是「整行 − 标签 − 间距」算出来的 */
const LABEL_GAP_PX = 8;
const LABEL_WIDTH_PX = 24;

/** jsdom 没有布局引擎，useResizeObserver 需要手动喂宽度 */
class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  callback: ResizeObserverCallback;
  element: Element | null = null;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }

  observe(el: Element) {
    this.element = el;
  }
  unobserve() {}
  disconnect() {}

  emit(width: number) {
    this.callback(
      [{ contentRect: { width } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

describe("IpAddressLine", () => {
  beforeEach(() => {
    ResizeObserverMock.instances = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mountLine = (props: Record<string, unknown> = {}) =>
    mount(IpAddressLine, { props: { label: "外网", value: V6, ...props } });

  /**
   * 组件会建两个 observer（整行、标签）。用元素本身来认，别依赖创建顺序；
   * 顺序真变了也要炸在断言里，而不是悄悄量错宽度。
   */
  const takeObservers = () => {
    const row = ResizeObserverMock.instances.find((o) =>
      String(o.element?.className ?? "").includes("ip-address-line"),
    );
    const label = ResizeObserverMock.instances.find(
      (o) => (o.element?.textContent ?? "").trim() === "外网",
    );
    if (!row || !label) {
      throw new Error(
        `组件没有建出「整行 + 标签」两个 ResizeObserver（现有 ${ResizeObserverMock.instances.length} 个，元素：${ResizeObserverMock.instances
          .map((o) => String(o.element?.className ?? o.element?.textContent ?? "?"))
          .join(" / ")}）`,
      );
    }
    return { row, label };
  };

  /** 按「可用宽度」喂进去，内部换算成整行宽度，测试里就不用关心那个换算 */
  const resize = async (availableWidth: number) => {
    await nextTick(); // post-flush 的 watch 要等一个 tick 才会建 observer
    const { row, label } = takeObservers();
    row.emit(availableWidth + LABEL_WIDTH_PX + LABEL_GAP_PX);
    label.emit(LABEL_WIDTH_PX);
    await nextTick();
  };

  // 这一条是回归保护：只要有人把 shrink-0 / whitespace-nowrap 删掉，
  // 长地址就会重新把标签挤成竖排、把地址从字符中间撕开。
  it("标签锁死不收缩，地址锁死不换行", () => {
    const wrapper = mountLine();
    const label = wrapper.find("span");
    expect(label.classes()).toContain("shrink-0");
    expect(label.classes()).toContain("whitespace-nowrap");

    const addr = wrapper.find(".ip-address-value");
    expect(addr.classes()).toContain("whitespace-nowrap");
    expect(addr.classes()).toContain("overflow-hidden");
    expect(addr.classes()).toContain("min-w-0");
  });

  // 回归保护：地址一旦回到 flex-1，就会被撑到行尾，拖宽卡片后「外网」和地址隔很远。
  it("地址按内容宽度收窄，与标签一起居中（不被 flex-1 撑到行尾）", () => {
    const wrapper = mountLine();
    const row = wrapper.find(".ip-address-line");
    expect(row.classes()).toContain("justify-center");

    const addr = wrapper.find(".ip-address-value");
    expect(addr.classes()).not.toContain("flex-1");
    expect(addr.classes()).not.toContain("w-full");
  });

  it("量的是整行与标签，不是地址自身（否则收窄后会自激）", async () => {
    mountLine();
    await nextTick();
    const { row, label } = takeObservers();
    expect(String(row.element?.className)).toContain("ip-address-line");
    expect((label.element?.textContent ?? "").trim()).toBe("外网");
  });

  it("宽度没测到时先按原样渲染（不闪烁）", () => {
    const wrapper = mountLine({ baseFontSize: 20 });
    expect(wrapper.find(".ip-address-value").text()).toBe(V6);
  });

  it("容器够宽时完整显示，并用基准字号", async () => {
    const wrapper = mountLine({ baseFontSize: 14 });
    await resize(400);

    const addr = wrapper.find(".ip-address-value");
    expect(addr.text()).toBe(V6);
    expect(addr.attributes("style")).toContain("font-size: 14px");
  });

  it("容器变窄时改成中段省略，且结果必定不含空白（单行）", async () => {
    const wrapper = mountLine({ baseFontSize: 20 });
    await resize(90);

    const addr = wrapper.find(".ip-address-value");
    expect(addr.text()).toBe("240e:3a5:…3456");
    expect(addr.text()).not.toMatch(/\s/);
  });

  it("可用宽度 = 整行 − 标签 − 间距（不是整行）", async () => {
    const wrapper = mountLine({ baseFontSize: 20 });
    await nextTick();
    const { row, label } = takeObservers();

    // 整行只剩 100px，扣掉标签 24 + 间距 8 后只有 68 可用
    row.emit(100);
    label.emit(LABEL_WIDTH_PX);
    await nextTick();

    const expected = fitIpAddress({
      text: V6,
      availableWidth: 100 - LABEL_WIDTH_PX - LABEL_GAP_PX,
      baseFontSize: 20,
    });
    expect(wrapper.find(".ip-address-value").text()).toBe(expected.display);
    expect(expected.truncated).toBe(true);
  });

  it("宽度变化后会重新计算（拖大卡片能变回完整地址）", async () => {
    const wrapper = mountLine({ baseFontSize: 20 });
    const addr = wrapper.find(".ip-address-value");

    await resize(90);
    expect(addr.text()).toBe("240e:3a5:…3456");

    await resize(300);
    expect(addr.text()).toBe(V6);
  });

  it("点击时把完整的原始地址抛给父组件，而不是省略后的文本", async () => {
    const wrapper = mountLine({ baseFontSize: 20 });
    await resize(90);
    expect(wrapper.find(".ip-address-value").text()).not.toBe(V6);

    await wrapper.find(".ip-address-value").trigger("click");
    expect(wrapper.emitted("copy")).toEqual([[V6]]);
  });

  it("点标签也能复制 —— 地址收窄后整行都是点击区", async () => {
    const wrapper = mountLine();
    await wrapper.find(".ip-address-line > span").trigger("click");
    expect(wrapper.emitted("copy")).toEqual([[V6]]);
  });

  it("title 里始终是完整地址，不受省略影响", async () => {
    const wrapper = mountLine({ baseFontSize: 20 });
    await resize(90);
    const title = wrapper.find(".ip-address-line").attributes("title") || "";
    expect(title).toContain(V6);
  });
});
