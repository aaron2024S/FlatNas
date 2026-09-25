import { ref, onUnmounted } from "vue";
import { useMainStore } from "@/stores/main";

export type SysStats = {
  cpu: {
    currentLoad: number;
    currentLoadUser: number;
    currentLoadSystem: number;
    manufacturer?: string;
    brand?: string;
    speed?: number;
    cores?: number;
  };
  mem: { total: number; used: number; active: number; available: number };
  disk: { fs: string; type: string; size: number; used: number; use: number; mount: string }[];
  network?: { iface: string; rx_sec: number; tx_sec: number }[];
  uptime?: number;
};

// 模块级单例：多张系统状态卡片共享一个轮询器
const stats = ref<SysStats | null>(null);
const failed = ref(false);

let pollTimer: ReturnType<typeof setInterval> | null = null;
let refCount = 0;

const POLL_MS = 5000;

const fetchOnce = async () => {
  try {
    const store = useMainStore();
    const headers = store.getHeaders();
    const res = await fetch("/api/system/stats", { headers });
    if (!res.ok) {
      failed.value = true;
      return;
    }
    const data = await res.json();
    if (data.success && data.data) {
      stats.value = data.data as SysStats;
      failed.value = false;
    } else {
      failed.value = true;
    }
  } catch {
    failed.value = true;
  }
};

const startPolling = () => {
  if (pollTimer) return;
  void fetchOnce();
  pollTimer = setInterval(() => {
    if (document.visibilityState === "hidden") return;
    void fetchOnce();
  }, POLL_MS);
};

const stopPolling = () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
};

/**
 * 系统状态共享轮询。所有使用方 return 前必须调用 release()（组件卸载时自动）。
 */
export function useSystemStats() {
  refCount++;
  startPolling();
  onUnmounted(() => {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0) stopPolling();
  });
  return { stats, failed, refresh: fetchOnce };
}
