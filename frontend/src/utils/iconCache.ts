/**
 * 「图标缓存管理」的纯逻辑层。
 *
 * 之所以单独抽出来：组件里做 fetch / 渲染不好测，这里全部是纯函数，
 * 排序、过滤、统计、错误解析都能被穷举验证。
 */

export interface IconCacheFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
  refCount: number;
}

export interface IconCacheList {
  files: IconCacheFile[];
  totalSize: number;
  totalCount: number;
  unreferencedCount: number;
}

export type IconCacheSortMode = "newest" | "oldest" | "name" | "size" | "refs";

export const ICON_CACHE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.svg,.ico,image/*";

export const iconCachePath = (name: string) => `/icon-cache/${name}`;

/** 展示用：从 /icon-cache/<sha>.webp 里取回文件名 */
export const iconCacheNameFromPath = (path: string): string => {
  const raw = String(path || "").trim();
  if (!raw) return "";
  const cut = raw.search(/[?#]/);
  const clean = cut >= 0 ? raw.slice(0, cut) : raw;
  const slash = clean.lastIndexOf("/");
  return slash >= 0 ? clean.slice(slash + 1) : clean;
};

/** 体积格式化：B / KB / MB / GB */
export const formatBytes = (bytes: number): string => {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const compareName = (a: IconCacheFile, b: IconCacheFile) => a.name.localeCompare(b.name);

/** 稳定排序：同键值时退回文件名升序，保证列表不会随机跳动 */
export const sortIconFiles = (
  files: readonly IconCacheFile[],
  mode: IconCacheSortMode,
): IconCacheFile[] => {
  const list = [...files];
  switch (mode) {
    case "oldest":
      return list.sort((a, b) => a.modifiedAt - b.modifiedAt || compareName(a, b));
    case "name":
      return list.sort(compareName);
    case "size":
      return list.sort((a, b) => b.size - a.size || compareName(a, b));
    case "refs":
      return list.sort(
        (a, b) => b.refCount - a.refCount || b.modifiedAt - a.modifiedAt || compareName(a, b),
      );
    case "newest":
    default:
      return list.sort((a, b) => b.modifiedAt - a.modifiedAt || compareName(a, b));
  }
};

/** 关键词过滤：命中文件名或完整路径（都忽略大小写） */
export const filterIconFiles = (
  files: readonly IconCacheFile[],
  keyword: string,
): IconCacheFile[] => {
  const needle = String(keyword || "")
    .trim()
    .toLowerCase();
  if (!needle) return [...files];
  return files.filter(
    (file) =>
      file.name.toLowerCase().includes(needle) || file.path.toLowerCase().includes(needle),
  );
};

/** 统计：总大小 / 总数 / 未引用数 —— 由前端根据完整列表算，避免排序过滤后失真 */
export const summarizeIconFiles = (
  files: readonly IconCacheFile[],
): { totalSize: number; totalCount: number; unreferencedCount: number } => {
  let totalSize = 0;
  let unreferencedCount = 0;
  for (const file of files) {
    totalSize += Number(file.size) || 0;
    if ((Number(file.refCount) || 0) <= 0) unreferencedCount += 1;
  }
  return { totalSize, totalCount: files.length, unreferencedCount };
};

const toIconCacheFile = (raw: unknown): IconCacheFile | null => {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const name = String(record.name ?? "").trim();
  if (!name) return null;
  const path = String(record.path ?? "").trim() || iconCachePath(name);
  return {
    name,
    path,
    size: Number(record.size) || 0,
    modifiedAt: Number(record.modifiedAt) || 0,
    refCount: Number(record.refCount) || 0,
  };
};

/** 容错解析列表接口响应：字段缺失 / 类型不对都不该让页面崩掉 */
export const parseIconCacheList = (raw: unknown): IconCacheList => {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawFiles = Array.isArray(record.files) ? record.files : [];
  const files = rawFiles
    .map(toIconCacheFile)
    .filter((file): file is IconCacheFile => file !== null);

  const summary = summarizeIconFiles(files);
  const totalSize = Number(record.totalSize);
  const totalCount = Number(record.totalCount);
  const unreferencedCount = Number(record.unreferencedCount);

  return {
    files,
    // 后端没给就用前端算的兜底
    totalSize: Number.isFinite(totalSize) && totalSize >= 0 ? totalSize : summary.totalSize,
    totalCount: Number.isFinite(totalCount) && totalCount >= 0 ? totalCount : summary.totalCount,
    unreferencedCount:
      Number.isFinite(unreferencedCount) && unreferencedCount >= 0
        ? unreferencedCount
        : summary.unreferencedCount,
  };
};

export interface IconCacheErrorInfo {
  code: string;
  message: string;
  refCount: number;
}

const STATUS_FALLBACK: Record<number, string> = {
  400: "请求参数不正确",
  401: "登录状态已过期，请重新登录",
  403: "没有权限执行该操作",
  404: "图标不存在，可能已被删除",
  409: "该图标正在被卡片使用",
  500: "服务器出错了，请稍后重试",
};

/** 容错解析错误响应，统一给出 code / message / refCount（删被引用图标时后端会带 refCount） */
export const parseIconCacheError = (raw: unknown, status: number): IconCacheErrorInfo => {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errorField = record.error;

  let code = "";
  let message = "";
  let refCount = 0;

  if (typeof errorField === "string") {
    message = errorField;
  } else if (errorField && typeof errorField === "object") {
    const err = errorField as Record<string, unknown>;
    code = String(err.code ?? "");
    message = String(err.message ?? "");
    refCount = Number(err.refCount) || 0;
  }

  if (!message) {
    message = STATUS_FALLBACK[status] || "操作失败，请稍后重试";
  }
  return { code, message, refCount };
};

/** 读取文件为 dataURL（上传图标用） */
export const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
