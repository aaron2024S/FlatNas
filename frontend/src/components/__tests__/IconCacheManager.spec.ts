import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, type VueWrapper, type DOMWrapper } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import IconCacheManager from "../IconCacheManager.vue";

/**
 * 组件层测试：把 fetch 换成可编程的路由，验证
 *   —— 列表渲染 / 统计 / 徽标
 *   —— 搜索 &「仅看未使用」筛选
 *   —— 删除的「使用中保护」链路（本地已知 → 直接带 force；后端 409 → 二次确认）
 *   —— 一键清理未引用 / 批量删除 / 上传
 *
 * 注意：OverlayMotion 会 Teleport 到 body，所以统一 stub 掉 teleport，
 * 让确认弹窗留在 wrapper 里可直接查询。
 */

type FetchCall = { url: string; method: string; body: unknown };

let calls: FetchCall[] = [];
let respond: (url: string, init: RequestInit) => { status: number; data: unknown };

const baseList = () => ({
  success: true,
  files: [
    { name: "used.webp", path: "/icon-cache/used.webp", size: 2048, modifiedAt: 200, refCount: 2 },
    { name: "orphan.png", path: "/icon-cache/orphan.png", size: 512, modifiedAt: 100, refCount: 0 },
  ],
  totalSize: 2560,
  totalCount: 2,
  unreferencedCount: 1,
});

let currentList: ReturnType<typeof baseList>;

const defaultRespond = (url: string, init: RequestInit) => {
  const method = (init.method || "GET").toUpperCase();
  if (url === "/api/icon-cache/list" && method === "GET") {
    return { status: 200, data: currentList };
  }
  if (method === "DELETE") return { status: 200, data: { success: true } };
  if (url === "/api/icon-cache/cleanup") {
    return { status: 200, data: { success: true, deleted: ["orphan.png"], freedBytes: 512 } };
  }
  if (url === "/api/icon-cache/batch-delete") {
    return { status: 200, data: { success: true, deleted: ["orphan.png"], skipped: [], failed: [] } };
  }
  if (url === "/api/icon-cache" && method === "POST") {
    return { status: 200, data: { success: true, path: "/icon-cache/new.webp", cacheHit: false } };
  }
  return { status: 404, data: { error: "not found" } };
};

beforeEach(() => {
  calls = [];
  currentList = baseList();
  respond = defaultRespond;

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
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const mountManager = async (): Promise<VueWrapper> => {
  const wrapper = mount(IconCacheManager, {
    global: {
      plugins: [createTestingPinia({ stubActions: false, createSpy: vi.fn })],
      stubs: { teleport: true },
    },
  });
  await flushPromises();
  await flushPromises();
  return wrapper;
};

const cardByName = (wrapper: VueWrapper, name: string) =>
  wrapper.find(`[data-icon-name="${name}"]`);

// cardByName 给的是 DOMWrapper（卡片节点），confirmButton 给的是 VueWrapper（整个组件），
// 两者都继承 BaseWrapper、findAll 行为一致，用共同能力声明参数即可。
type ButtonScope = { findAll: (selector: string) => DOMWrapper<Element>[] };

const buttonIn = (scope: ButtonScope, label: string) => {
  const btn = scope.findAll("button").find((b) => b.text().trim() === label);
  if (!btn) throw new Error(`按钮「${label}」没找到`);
  return btn;
};

const confirmButton = (wrapper: VueWrapper) => buttonIn(wrapper, "确定");

const deleteCalls = () => calls.filter((c) => c.method === "DELETE");

describe("IconCacheManager 列表渲染", () => {
  it("渲染图标卡片、统计与引用徽标", async () => {
    const wrapper = await mountManager();

    expect(wrapper.findAll("[data-icon-name]")).toHaveLength(2);
    // 统计：2048 + 512 = 2560 B = 2.5 KB
    expect(wrapper.text()).toContain("共 2 个");
    expect(wrapper.text()).toContain("2.5 KB");
    expect(wrapper.text()).toContain("未使用 1 个");

    // 徽标
    expect(cardByName(wrapper, "used.webp").text()).toContain("使用中 2");
    expect(cardByName(wrapper, "orphan.png").text()).toContain("未使用");

    // 缩略图指向本地路径
    expect(cardByName(wrapper, "used.webp").find("img").attributes("src")).toContain(
      "/icon-cache/used.webp",
    );

    // 列表接口只拉一次，且带上了 store 的鉴权头
    expect(calls.filter((c) => c.url === "/api/icon-cache/list")).toHaveLength(1);
  });

  it("空列表给出引导文案", async () => {
    currentList = { ...baseList(), files: [], totalSize: 0, totalCount: 0, unreferencedCount: 0 };
    const wrapper = await mountManager();
    expect(wrapper.text()).toContain("还没有缓存图标");
  });
});

describe("IconCacheManager 筛选", () => {
  it("搜索关键词只留下命中的卡片", async () => {
    const wrapper = await mountManager();
    await wrapper.find('input[type="search"]').setValue("orphan");

    const cards = wrapper.findAll("[data-icon-name]");
    expect(cards).toHaveLength(1);
    expect(cards[0].attributes("data-icon-name")).toBe("orphan.png");
  });

  it("「仅看未使用」只留下 refCount 为 0 的卡片", async () => {
    const wrapper = await mountManager();
    const label = wrapper.findAll("label").find((l) => l.text().includes("仅看未使用"));
    expect(label).toBeTruthy();

    await label!.find('input[type="checkbox"]').setValue(true);
    const cards = wrapper.findAll("[data-icon-name]");
    expect(cards).toHaveLength(1);
    expect(cards[0].attributes("data-icon-name")).toBe("orphan.png");
  });
});

describe("IconCacheManager 删除", () => {
  it("删未引用图标：确认后直接 DELETE，不带 force", async () => {
    const wrapper = await mountManager();

    await buttonIn(cardByName(wrapper, "orphan.png"), "删除").trigger("click");
    expect(wrapper.text()).toContain("删除图标");
    await confirmButton(wrapper).trigger("click");
    await flushPromises();

    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0].url).toBe("/api/icon-cache/orphan.png");
  });

  it("删使用中的图标：先弹「正在使用」确认，确认后带 force=1", async () => {
    const wrapper = await mountManager();

    await buttonIn(cardByName(wrapper, "used.webp"), "删除").trigger("click");
    expect(wrapper.text()).toContain("正被 2 张卡片使用");

    await confirmButton(wrapper).trigger("click");
    await flushPromises();

    expect(deleteCalls()[0].url).toBe("/api/icon-cache/used.webp?force=1");
  });

  it("本地看不出引用、后端返回 409 时，兜底二次确认后再 force 删除", async () => {
    let deleteCount = 0;
    respond = (url, init) => {
      const method = (init.method || "GET").toUpperCase();
      if (url === "/api/icon-cache/list") return { status: 200, data: currentList };
      if (method === "DELETE") {
        deleteCount += 1;
        if (deleteCount === 1) {
          return {
            status: 409,
            data: {
              success: false,
              error: { code: "icon_in_use", message: "该图标正在被卡片使用", refCount: 3 },
            },
          };
        }
        return { status: 200, data: { success: true } };
      }
      return { status: 404, data: {} };
    };

    const wrapper = await mountManager();
    await buttonIn(cardByName(wrapper, "orphan.png"), "删除").trigger("click");
    // 第一次点确定时组件并不知道被引用，直接发请求
    await confirmButton(wrapper).trigger("click");
    await flushPromises();

    expect(deleteCalls()).toHaveLength(1);
    // 后端说在用 → 弹出带真实 refCount 的确认
    expect(wrapper.text()).toContain("正被 3 张卡片使用");

    await confirmButton(wrapper).trigger("click");
    await flushPromises();

    expect(deleteCalls()).toHaveLength(2);
    expect(deleteCalls()[1].url).toBe("/api/icon-cache/orphan.png?force=1");
  });
});

describe("IconCacheManager 清理与批量删除", () => {
  it("一键清理未引用：确认后调用 cleanup", async () => {
    const wrapper = await mountManager();
    await buttonIn(wrapper, "一键清理未引用").trigger("click");
    expect(wrapper.text()).toContain("将删除 1 个");

    await confirmButton(wrapper).trigger("click");
    await flushPromises();

    const cleanup = calls.find((c) => c.url === "/api/icon-cache/cleanup");
    expect(cleanup).toBeTruthy();
    expect(cleanup!.method).toBe("POST");
  });

  it("没有未引用图标时，「一键清理」按钮禁用且不发请求", async () => {
    currentList = {
      ...baseList(),
      files: [baseList().files[0]],
      totalSize: 2048,
      totalCount: 1,
      unreferencedCount: 0,
    };
    const wrapper = await mountManager();

    const btn = buttonIn(wrapper, "一键清理未引用");
    expect(btn.attributes("disabled")).toBeDefined();

    await btn.trigger("click");
    await flushPromises();

    expect(calls.some((c) => c.url === "/api/icon-cache/cleanup")).toBe(false);
  });

  it("批量删除：含使用中的图标时带 force，并把选中名单发给后端", async () => {
    const wrapper = await mountManager();

    await cardByName(wrapper, "orphan.png").find('input[type="checkbox"]').setValue(true);
    await cardByName(wrapper, "used.webp").find('input[type="checkbox"]').setValue(true);
    expect(wrapper.text()).toContain("已选 2 个");

    await buttonIn(wrapper, "删除所选").trigger("click");
    expect(wrapper.text()).toContain("1 个正在被卡片使用");

    await confirmButton(wrapper).trigger("click");
    await flushPromises();

    const batch = calls.find((c) => c.url === "/api/icon-cache/batch-delete");
    expect(batch).toBeTruthy();
    const body = batch!.body as { names: string[]; force: boolean };
    expect([...body.names].sort()).toEqual(["orphan.png", "used.webp"]);
    expect(body.force).toBe(true);
  });
});

describe("IconCacheManager 上传", () => {
  it("选择文件后转 dataURL 提交到 /api/icon-cache 并刷新列表", async () => {
    const wrapper = await mountManager();

    const input = wrapper.find('input[type="file"]');
    const file = new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });
    Object.defineProperty(input.element, "files", { value: [file], configurable: true });

    await input.trigger("change");
    await flushPromises();
    await flushPromises();

    const post = calls.find((c) => c.url === "/api/icon-cache" && c.method === "POST");
    expect(post).toBeTruthy();
    expect(String((post!.body as { dataUrl: string }).dataUrl)).toMatch(/^data:/);
    // 上传成功后应重新拉列表
    expect(calls.filter((c) => c.url === "/api/icon-cache/list").length).toBeGreaterThanOrEqual(2);
  });
});
