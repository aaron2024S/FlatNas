import { describe, it, expect } from "vitest";
import {
  formatBytes,
  filterIconFiles,
  iconCacheNameFromPath,
  iconCachePath,
  parseIconCacheError,
  parseIconCacheList,
  sortIconFiles,
  summarizeIconFiles,
  type IconCacheFile,
} from "./iconCache";

const file = (over: Partial<IconCacheFile> & { name: string }): IconCacheFile => ({
  path: iconCachePath(over.name),
  size: 1024,
  modifiedAt: 1000,
  refCount: 0,
  ...over,
});

describe("formatBytes", () => {
  it("按 B / KB / MB / GB 分档，非法值退回 0 B", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.50 MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.00 GB");
  });
});

describe("iconCacheNameFromPath", () => {
  it("从各种形态的路径里取出文件名", () => {
    expect(iconCacheNameFromPath("/icon-cache/abc.webp")).toBe("abc.webp");
    expect(iconCacheNameFromPath("http://h:3000/icon-cache/ABC.PNG")).toBe("ABC.PNG");
    expect(iconCacheNameFromPath("/icon-cache/abc.webp?t=123")).toBe("abc.webp");
    expect(iconCacheNameFromPath("/icon-cache/abc.webp#x")).toBe("abc.webp");
    expect(iconCacheNameFromPath("abc.webp")).toBe("abc.webp");
    expect(iconCacheNameFromPath("")).toBe("");
  });
});

describe("sortIconFiles", () => {
  const files = [
    file({ name: "b.webp", modifiedAt: 100, size: 300, refCount: 1 }),
    file({ name: "a.webp", modifiedAt: 300, size: 100, refCount: 0 }),
    file({ name: "c.webp", modifiedAt: 200, size: 200, refCount: 3 }),
  ];
  const names = (list: IconCacheFile[]) => list.map((f) => f.name);

  it("newest（默认）按上传时间倒序", () => {
    expect(names(sortIconFiles(files, "newest"))).toEqual(["a.webp", "c.webp", "b.webp"]);
  });

  it("oldest 按上传时间正序", () => {
    expect(names(sortIconFiles(files, "oldest"))).toEqual(["b.webp", "c.webp", "a.webp"]);
  });

  it("name 按文件名排序", () => {
    expect(names(sortIconFiles(files, "name"))).toEqual(["a.webp", "b.webp", "c.webp"]);
  });

  it("size 按体积倒序", () => {
    expect(names(sortIconFiles(files, "size"))).toEqual(["b.webp", "c.webp", "a.webp"]);
  });

  it("refs 按引用次数倒序", () => {
    expect(names(sortIconFiles(files, "refs"))).toEqual(["c.webp", "b.webp", "a.webp"]);
  });

  it("不修改入参（返回新数组）", () => {
    const before = names(files);
    sortIconFiles(files, "size");
    expect(names(files)).toEqual(before);
  });

  it("同键值时退回文件名升序，结果稳定", () => {
    const same = [file({ name: "z.webp" }), file({ name: "m.webp" }), file({ name: "a.webp" })];
    expect(names(sortIconFiles(same, "newest"))).toEqual(["a.webp", "m.webp", "z.webp"]);
  });
});

describe("filterIconFiles", () => {
  const files = [file({ name: "GitHub.webp" }), file({ name: "nas.svg" }), file({ name: "a1.png" })];

  it("空关键词返回全部（新数组）", () => {
    const out = filterIconFiles(files, "   ");
    expect(out).toHaveLength(3);
    expect(out).not.toBe(files);
  });

  it("忽略大小写命中文件名", () => {
    expect(filterIconFiles(files, "github").map((f) => f.name)).toEqual(["GitHub.webp"]);
    expect(filterIconFiles(files, "SVG").map((f) => f.name)).toEqual(["nas.svg"]);
  });

  it("也命中完整路径", () => {
    expect(filterIconFiles(files, "/icon-cache/a1").map((f) => f.name)).toEqual(["a1.png"]);
  });

  it("无命中返回空数组", () => {
    expect(filterIconFiles(files, "zzz")).toEqual([]);
  });
});

describe("summarizeIconFiles", () => {
  it("统计总大小 / 总数 / 未引用数", () => {
    const out = summarizeIconFiles([
      file({ name: "a", size: 100, refCount: 0 }),
      file({ name: "b", size: 200, refCount: 2 }),
      file({ name: "c", size: 300, refCount: 0 }),
    ]);
    expect(out).toEqual({ totalSize: 600, totalCount: 3, unreferencedCount: 2 });
  });

  it("空列表全为 0", () => {
    expect(summarizeIconFiles([])).toEqual({ totalSize: 0, totalCount: 0, unreferencedCount: 0 });
  });
});

describe("parseIconCacheList", () => {
  it("正常解析并保留后端统计值", () => {
    const out = parseIconCacheList({
      success: true,
      files: [{ name: "a.webp", path: "/icon-cache/a.webp", size: 10, modifiedAt: 5, refCount: 1 }],
      totalSize: 10,
      totalCount: 1,
      unreferencedCount: 0,
    });
    expect(out.files).toHaveLength(1);
    expect(out).toMatchObject({ totalSize: 10, totalCount: 1, unreferencedCount: 0 });
  });

  it("缺 path 时按 name 补出路径", () => {
    const out = parseIconCacheList({ files: [{ name: "x.webp" }] });
    expect(out.files[0].path).toBe("/icon-cache/x.webp");
  });

  it("后端没给统计值时前端兜底算", () => {
    const out = parseIconCacheList({
      files: [
        { name: "a.webp", size: 4, refCount: 0 },
        { name: "b.webp", size: 6, refCount: 3 },
      ],
    });
    expect(out).toMatchObject({ totalSize: 10, totalCount: 2, unreferencedCount: 1 });
  });

  it("脏数据（非对象 / files 非数组 / 缺 name）不抛异常", () => {
    expect(parseIconCacheList(null)).toEqual({
      files: [],
      totalSize: 0,
      totalCount: 0,
      unreferencedCount: 0,
    });
    expect(parseIconCacheList({ files: "nope" }).files).toEqual([]);
    expect(parseIconCacheList({ files: [null, 1, { nope: 1 }, { name: "ok.png" }] }).files).toEqual([
      { name: "ok.png", path: "/icon-cache/ok.png", size: 0, modifiedAt: 0, refCount: 0 },
    ]);
  });
});

describe("parseIconCacheError", () => {
  it("解析结构化错误并带出 refCount", () => {
    const out = parseIconCacheError(
      { success: false, error: { code: "icon_in_use", message: "该图标正在被卡片使用", refCount: 3 } },
      409,
    );
    expect(out).toEqual({ code: "icon_in_use", message: "该图标正在被卡片使用", refCount: 3 });
  });

  it("error 是字符串时也能用", () => {
    const out = parseIconCacheError({ error: "boom" }, 500);
    expect(out.message).toBe("boom");
    expect(out.code).toBe("");
  });

  it("无结构化错误时按状态码给兜底文案", () => {
    expect(parseIconCacheError(null, 401).message).toContain("登录状态");
    expect(parseIconCacheError({}, 409).message).toContain("正在被卡片使用");
    expect(parseIconCacheError(undefined, 418).message).toBe("操作失败，请稍后重试");
  });
});
