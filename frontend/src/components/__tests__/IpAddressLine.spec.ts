// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import IpAddressLine from "../base/IpAddressLine.vue";

const V6 = "240e:3a5:483b:5e40:808a:37ff:fe12:3456";

/** jsdom 没有布局引擎，useResizeObserver 需要手动喂宽度 */
class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }

  observe() {}
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

  const resize = async (width: number) => {
    const observer = ResizeObserverMock.instances[ResizeObserverMock.instances.length - 1];
    if (!observer) throw new Error("组件没有创建 ResizeObserver");
    observer.emit(width);
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

  it("title 里始终是完整地址，不受省略影响", async () => {
    const wrapper = mountLine({ baseFontSize: 20 });
    await resize(90);
    const title = wrapper.find(".ip-address-value").attributes("title") || "";
    expect(title).toContain(V6);
  });
});
