import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import IconLibraryPicker from "../IconLibraryPicker.vue";

/**
 * 「从图标库选择」弹窗：浏览已缓存图标 → 点选即回传本地路径。
 * 这里重点验证「选中即 emit 路径 + 关闭」，以及「上传新图标后直接选用」。
 */

type FetchCall = { url: string; method: string; body: unknown };

let calls: FetchCall[] = [];
let respond: (url: string, init: RequestInit) => { status: number; data: unknown };

const listPayload = () => ({
  success: true,
  files: [
    { name: "github.webp", path: "/icon-cache/github.webp", size: 1024, modifiedAt: 200, refCount: 1 },
    { name: "nas.svg", path: "/icon-cache/nas.svg", size: 2048, modifiedAt: 100, refCount: 0 },
  ],
  totalSize: 3072,
  totalCount: 2,
  unreferencedCount: 1,
});

beforeEach(() => {
  calls = [];
  respond = (url, init) => {
    const method = (init.method || "GET").toUpperCase();
    if (url === "/api/icon-cache/list") return { status: 200, data: listPayload() };
    if (url === "/api/icon-cache" && method === "POST") {
      return { status: 200, data: { success: true, path: "/icon-cache/uploaded.webp", cacheHit: false } };
    }
    return { status: 404, data: { error: "not found" } };
  };

  vi.stubGlobal("fetch", (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : String(input);
    const method = (init.method || "GET").toUpperCase();
    let body: unknown = undefined;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method, body });
    const { status, data } = respond(url, init);
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => data });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const mountPicker = async (): Promise<VueWrapper> => {
  const wrapper = mount(IconLibraryPicker, {
    props: { show: true },
    global: {
      plugins: [createTestingPinia({ stubActions: false, createSpy: vi.fn })],
      stubs: { teleport: true },
    },
  });
  await flushPromises();
  await flushPromises();
  return wrapper;
};

const tileByName = (wrapper: VueWrapper, name: string) => {
  const tile = wrapper.findAll("button").find((b) => b.attributes("title") === name);
  if (!tile) throw new Error(`图标 ${name} 没找到`);
  return tile;
};

describe("IconLibraryPicker", () => {
  it("挂载即拉取列表并渲染图标数量", async () => {
    const wrapper = await mountPicker();

    expect(calls.filter((c) => c.url === "/api/icon-cache/list")).toHaveLength(1);
    expect(wrapper.text()).toContain("2 个");
    expect(tileByName(wrapper, "github.webp")).toBeTruthy();
    expect(tileByName(wrapper, "nas.svg")).toBeTruthy();
  });

  it("点图标 → emit select(本地路径) 并请求关闭", async () => {
    const wrapper = await mountPicker();

    await tileByName(wrapper, "github.webp").trigger("click");

    expect(wrapper.emitted("select")?.[0]).toEqual(["/icon-cache/github.webp"]);
    expect(wrapper.emitted("update:show")?.[0]).toEqual([false]);
  });

  it("搜索可过滤图标", async () => {
    const wrapper = await mountPicker();
    await wrapper.find('input[type="search"]').setValue("nas");

    expect(wrapper.findAll("button[title]").map((b) => b.attributes("title"))).toEqual(["nas.svg"]);
  });

  it("空库时展示引导，不发多余请求", async () => {
    respond = () => ({
      status: 200,
      data: { success: true, files: [], totalSize: 0, totalCount: 0, unreferencedCount: 0 },
    });
    const wrapper = await mountPicker();

    expect(wrapper.text()).toContain("还没有缓存图标");
    expect(wrapper.findAll("button[title]")).toHaveLength(0);
  });

  it("上传新图标后直接选中它并关闭", async () => {
    const wrapper = await mountPicker();

    const input = wrapper.find('input[type="file"]');
    const file = new File([new Uint8Array([9, 9])], "new.png", { type: "image/png" });
    Object.defineProperty(input.element, "files", { value: [file], configurable: true });

    await input.trigger("change");
    await flushPromises();
    await flushPromises();

    const post = calls.find((c) => c.url === "/api/icon-cache" && c.method === "POST");
    expect(post).toBeTruthy();
    expect(String((post!.body as { dataUrl: string }).dataUrl)).toMatch(/^data:/);
    expect(wrapper.emitted("select")?.[0]).toEqual(["/icon-cache/uploaded.webp"]);
    expect(wrapper.emitted("update:show")?.[0]).toEqual([false]);
  });

  it("列表接口失败时给出错误态与重试入口", async () => {
    respond = () => ({ status: 500, data: { error: { code: "boom", message: "服务器出错了" } } });
    const wrapper = await mountPicker();

    expect(wrapper.text()).toContain("服务器出错了");
    expect(wrapper.findAll("button").some((b) => b.text().trim() === "重试")).toBe(true);
  });
});
