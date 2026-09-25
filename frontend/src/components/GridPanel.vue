<script setup lang="ts">
import {
  ref,
  reactive,
  onMounted,
  onUnmounted,
  computed,
  watch,
  nextTick,
  toRef,
  defineAsyncComponent,
  type Component,
  type AsyncComponentLoader,
} from "vue";
import { VueDraggable } from "vue-draggable-plus";
import { GridLayout, GridItem } from "grid-layout-plus";
import { useStorage, useWindowSize, useIntervalFn, onClickOutside } from "@vueuse/core";
import { useMainStore } from "../stores/main";
import { useWallpaperRotation } from "../composables/useWallpaperRotation";
import { useDevice } from "../composables/useDevice";
import { generateLayout, type GridLayoutItem } from "../utils/gridLayout";
import type { NavItem, WidgetConfig, NavGroup } from "@/types";
import OverlayMotion from "@/components/base/OverlayMotion.vue";
import { isInternalNetwork, getNetworkConfig, computeEffectiveNetworkMode } from "@/utils/network";
import DOMPurify from "dompurify";
const CHUNK_RELOAD_KEY = "flatnas:chunk-reload-at";
const loadAsync = <T extends Component>(loader: AsyncComponentLoader<T>) =>
  defineAsyncComponent({
    loader,
    onError(error, retry, fail, attempts) {
      const msg = error instanceof Error ? error.message : String(error ?? "");
      const chunkFailed =
        /Failed to fetch dynamically imported module/i.test(msg) ||
        /Importing a module script failed/i.test(msg) ||
        /ChunkLoadError/i.test(msg) ||
        /Loading chunk [\w-]+ failed/i.test(msg);
      if (chunkFailed && typeof window !== "undefined") {
        const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || "0");
        const now = Date.now();
        if (!Number.isFinite(last) || now - last > 30000) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
          const url = new URL(window.location.href);
          url.searchParams.set("_r", String(now));
          window.location.replace(url.toString());
          return;
        }
      }
      if (attempts <= 1) {
        retry();
      } else {
        fail();
      }
    },
  });
const EditModal = loadAsync(() => import("./EditModal.vue"));
const SettingsModal = loadAsync(() => import("./SettingsModal.vue"));
const GroupSettingsModal = loadAsync(() => import("./GroupSettingsModal.vue"));
/** 同步导入，避免生产/Docker 下动态 chunk 请求失败导致登录框无法弹出；LoginModal 内已做 store/authMode 防御 */
import LoginModal from "./LoginModal.vue";
const BookmarkWidget = loadAsync(() => import("./BookmarkWidget.vue"));
const MemoWidget = loadAsync(() => import("./MemoWidget.vue"));
const TodoWidget = loadAsync(() => import("./TodoWidget.vue"));
const CalculatorWidget = loadAsync(() => import("./CalculatorWidget.vue"));
const MusicWidget = loadAsync(() => import("./MusicWidget.vue"));
const MiniPlayer = loadAsync(() => import("./MiniPlayer.vue"));
const HotWidget = loadAsync(() => import("./HotWidget.vue"));
const ClockWeatherWidget = loadAsync(() => import("./ClockWeatherWidget.vue"));
const RssWidget = loadAsync(() => import("./RssWidget.vue"));
const IconShape = loadAsync(() => import("./IconShape.vue"));
const IframeWidget = loadAsync(() => import("./IframeWidget.vue"));
const SimpleWeatherWidget = loadAsync(() => import("./SimpleWeatherWidget.vue"));
const CalendarWidget = loadAsync(() => import("./CalendarWidget.vue"));
const ClockWidget = loadAsync(() => import("./ClockWidget.vue"));
const AppSidebar = loadAsync(() => import("./AppSidebar.vue"));
const CountdownWidget = loadAsync(() => import("./CountdownWidget.vue"));
const CountUpWidget = loadAsync(() => import("./CountUpWidget.vue"));
const DockerWidget = loadAsync(() => import("./DockerWidget.vue"));
const SystemStatCard = loadAsync(() => import("./SystemStatCard.vue"));
const SystemStatEditModal = loadAsync(() => import("./SystemStatEditModal.vue"));
const CustomCssWidget = loadAsync(() => import("./CustomCssWidget.vue"));
const AmapWeatherWidget = loadAsync(() => import("./AmapWeatherWidget.vue"));
const FileTransferWidget = loadAsync(() => import("./FileTransferWidget.vue"));
const SizeSelector = loadAsync(() => import("./SizeSelector.vue"));

const store = useMainStore();
const { apiUpdateError, resetError } = useWallpaperRotation();
const { deviceKey, isMobile } = useDevice(toRef(store.appConfig, "deviceMode"));
const { width, height } = useWindowSize();
const isHeaderRowLayout = computed(() => width.value >= 1280);
const gridWidgetTypes = new Set([
  "clock",
  "weather",
  "calendar",
  "memo",
  "todo",
  "music",
  "calculator",
  "ip",
  "div-card",
  "countdown",
  "countup",
  "iframe",
  "bookmarks",
  "hot",
  "clockweather",
  "amap-weather",
  "rss",
  "docker",
  "custom-css",
  "file-transfer",
]);

const currentHour = ref(new Date().getHours());
let daylightTimer: ReturnType<typeof setInterval> | null = null;
const updateHour = () => {
  currentHour.value = new Date().getHours();
};
const isNightTime = computed(() => currentHour.value >= 18 || currentHour.value < 6);
const effectiveBackgroundMask = computed(() => {
  const base = store.appConfig.backgroundMask ?? 0;
  const daylightMask = store.appConfig.daylightMask ?? 0.5;
  if (store.appConfig.daylightModeEnabled && isNightTime.value) return daylightMask;
  return base;
});
const effectiveMobileBackgroundMask = computed(() => {
  const base = store.appConfig.mobileBackgroundMask ?? 0;
  const daylightMask = store.appConfig.daylightMask ?? 0.5;
  if (store.appConfig.daylightModeEnabled && isNightTime.value) return daylightMask;
  return base;
});

const weatherText = ref("");
const weatherLoading = ref(false);
const weatherEffectEnabled = computed(() => !!store.appConfig.weatherEffectEnabled);
const isRainWeather = computed(() => /雨|雷/.test(weatherText.value || ""));
const isFogWeather = computed(() => /雾|霾/.test(weatherText.value || ""));
const showFogEffect = computed(() => weatherEffectEnabled.value && isFogWeather.value);
const showRainEffect = computed(() => weatherEffectEnabled.value && isRainWeather.value);

const getWeatherCity = () => {
  try {
    const cached = localStorage.getItem("flatnas_auto_city");
    if (cached) {
      const data = JSON.parse(cached);
      if (data?.city) return data.city;
    }
  } catch {
    return "Shanghai";
  }
  return "Shanghai";
};

const buildWeatherUrl = (city: string) => {
  if (store.appConfig.weatherApiUrl) {
    let url = store.appConfig.weatherApiUrl;
    if (url.includes("{city}")) {
      url = url.replace("{city}", encodeURIComponent(city));
    }
    return url;
  }
  const source = store.appConfig.weatherSource || "uapi";
  const key = store.appConfig.amapKey || "";
  const projectId = store.appConfig.qweatherProjectId || "";
  const keyId = store.appConfig.qweatherKeyId || "";
  const privateKey = store.appConfig.qweatherPrivateKey || "";
  let url = `/api/weather?city=${encodeURIComponent(city)}&source=${source}&key=${encodeURIComponent(key)}`;
  if (source === "qweather") {
    url += `&projectId=${encodeURIComponent(projectId)}&keyId=${encodeURIComponent(keyId)}&privateKey=${encodeURIComponent(privateKey)}`;
  }
  return url;
};

const fetchWeatherForEffect = async () => {
  if (!weatherEffectEnabled.value || weatherLoading.value) return;
  weatherLoading.value = true;
  const city = getWeatherCity();
  try {
    const res = await fetch(buildWeatherUrl(city));
    if (!res.ok) throw new Error("weather");
    const data = await res.json();
    if (data?.data?.text) {
      weatherText.value = data.data.text;
    } else if (data?.text) {
      weatherText.value = data.text;
    } else if (data?.weather) {
      weatherText.value = data.weather;
    } else {
      weatherText.value = "";
    }
  } catch {
    weatherText.value = "";
  } finally {
    weatherLoading.value = false;
  }
};

type RainRenderer = { stop: () => void; resize: () => void };
const rainCanvasRef = ref<HTMLCanvasElement | null>(null);
const rainRenderer = ref<RainRenderer | null>(null);

const createRainRenderer = (canvas: HTMLCanvasElement): RainRenderer | null => {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false });
  if (!gl) return null;

  const vertexSource = `
    attribute vec3 a_position;
    uniform float u_time;
    uniform float u_speed;
    varying float v_alpha;
    void main() {
      float z = a_position.z;
      float speed = mix(0.4, 1.2, z) * u_speed;
      float y = fract(a_position.y - u_time * speed);
      float x = a_position.x * 2.0 - 1.0;
      float py = y * 2.0 - 1.0;
      float depth = mix(0.6, 1.0, z);
      gl_Position = vec4(x * depth, py * depth, 0.0, 1.0);
      gl_PointSize = mix(1.0, 4.0, z);
      v_alpha = mix(0.2, 0.8, z);
    }
  `;

  const fragmentSource = `
    precision mediump float;
    varying float v_alpha;
    void main() {
      vec2 uv = gl_PointCoord;
      float body = smoothstep(0.0, 0.25, uv.y) * (1.0 - smoothstep(0.75, 1.0, uv.y));
      float width = smoothstep(0.5, 0.0, abs(uv.x - 0.5));
      float alpha = body * width * v_alpha;
      gl_FragColor = vec4(0.7, 0.85, 1.0, alpha);
    }
  `;

  const compileShader = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  const positionLoc = gl.getAttribLocation(program, "a_position");
  const timeLoc = gl.getUniformLocation(program, "u_time");
  const speedLoc = gl.getUniformLocation(program, "u_speed");

  const count = 1200;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = Math.random();
    positions[i * 3 + 1] = Math.random();
    positions[i * 3 + 2] = Math.random();
  }

  const buffer = gl.createBuffer();
  if (!buffer) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  let running = true;
  let frame = 0;
  const start = performance.now();

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  const render = (now: number) => {
    if (!running) return;
    const t = (now - start) / 1000;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
    if (timeLoc) gl.uniform1f(timeLoc, t);
    if (speedLoc) gl.uniform1f(speedLoc, 0.6);
    gl.drawArrays(gl.POINTS, 0, count);
    frame = requestAnimationFrame(render);
  };

  resize();
  frame = requestAnimationFrame(render);

  const stop = () => {
    running = false;
    cancelAnimationFrame(frame);
  };

  return { stop, resize };
};

const initRain = async () => {
  if (!showRainEffect.value || rainRenderer.value) return;
  await nextTick();
  const canvas = rainCanvasRef.value;
  if (!canvas) return;
  const renderer = createRainRenderer(canvas);
  if (!renderer) return;
  rainRenderer.value = renderer;
  renderer.resize();
};

const stopRain = () => {
  rainRenderer.value?.stop();
  rainRenderer.value = null;
};

let weatherTimer: ReturnType<typeof setInterval> | null = null;

watch(
  () => weatherEffectEnabled.value,
  (enabled) => {
    if (enabled) {
      fetchWeatherForEffect();
      if (weatherTimer) clearInterval(weatherTimer);
      weatherTimer = setInterval(fetchWeatherForEffect, 2 * 60 * 60 * 1000);
    } else {
      if (weatherTimer) clearInterval(weatherTimer);
      weatherTimer = null;
      weatherText.value = "";
      stopRain();
    }
  },
  { immediate: true },
);

watch(
  () => [
    store.appConfig.weatherSource,
    store.appConfig.weatherApiUrl,
    store.appConfig.amapKey,
    store.appConfig.qweatherProjectId,
    store.appConfig.qweatherKeyId,
    store.appConfig.qweatherPrivateKey,
  ],
  () => {
    if (weatherEffectEnabled.value) fetchWeatherForEffect();
  },
);

watch([showRainEffect, () => rainCanvasRef.value], ([show]) => {
  if (show) {
    initRain();
  } else {
    stopRain();
  }
});

watch([width, height], () => {
  rainRenderer.value?.resize();
});

const empireBackgroundUrl = `data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4af37' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E`;

const showEditModal = ref(false);
const showSettingsModal = ref(false);
const showGroupSettingsModal = ref(false);

const showLoginModal = ref(false);
const isEditMode = ref(false);
/** 切换编辑模式；进入编辑时设 layoutEditInProgress，退出时 await 保存后再清空，避免外网竞态导致布局被覆盖 */
const toggleEditMode = async () => {
  if (isEditMode.value) {
    isEditMode.value = false;
    try {
      await store.saveData(true);
    } finally {
      store.layoutEditInProgress = false;
    }
  } else {
    store.layoutEditInProgress = true;
    isEditMode.value = true;
  }
};
const activeResizeWidgetId = ref<string | null>(null);
const currentEditItem = ref<NavItem | null>(null);
const currentGroupId = ref<string>("");
const activePaginationGroupId = computed<string>({
  get: () => store.webPaginationActiveGroupId || "",
  set: (val) => {
    store.webPaginationActiveGroupId = val;
  },
});
const isWebPaginationMode = computed(() => store.appConfig.webGroupPagination && !isMobile.value);
const mainContainerRef = ref<HTMLElement | null>(null);

const isGridAlive = ref(true);

watch(
  [() => store.groups, isWebPaginationMode],
  ([groups, mode]) => {
    if (mode && groups.length > 0) {
      if (
        !activePaginationGroupId.value ||
        !groups.find((g) => g.id === activePaginationGroupId.value)
      ) {
        const first = groups[0];
        if (first) {
          activePaginationGroupId.value = first.id;
        }
      }
    }
  },
  { immediate: true, deep: true },
);

watch(showGroupSettingsModal, (val) => {
  const wasEditing = isEditMode.value;
  isEditMode.value = val;
  if (val) {
    store.layoutEditInProgress = true;
  } else if (wasEditing) {
    store.markDirty();
    store.layoutEditInProgress = false;
    // 关闭分组设置时立即落盘：分组内的改动（标题/颜色/批量公开等）只改了 store，
    // 之前仅 markDirty 不触发保存，导致"批量公开/不公开"看似无效。
    void store.saveData(true);
  }
});
const isLanMode = ref(false);
const latency = ref(0);
const isChecking = ref(false);
const networkScope = typeof window !== "undefined" ? window.location.hostname : "default";
const networkConfig = computed(() => getNetworkConfig(store.appConfig, store.forceNetworkMode));
const forceMode = computed({
  get: () => store.forceNetworkMode,
  set: (val) => {
    store.forceNetworkMode = val;
  },
});
const latencyThresholdMs = computed(() => networkConfig.value.latencyThresholdMs);
const lastKnownClientIp = ref("");
const lastKnownClientIpSource = ref("");

const effectiveIsLan = computed(() => {
  if (!store.isLanModeInited) return false;
  const cfg = networkConfig.value;
  const result = computeEffectiveNetworkMode(
    window.location.hostname,
    lastKnownClientIp.value,
    lastKnownClientIpSource.value,
    latency.value,
    {
      internalDomains: cfg.internalDomains,
      networkRules: cfg.networkRules,
      forceNetworkMode: cfg.forceNetworkMode,
      latencyThresholdMs: cfg.latencyThresholdMs,
    },
  );
  return result.isLan;
});

watch(
  [isLanMode, latency, effectiveIsLan],
  ([lan, nextLatency, effective]) => {
    store.isLanMode = lan;
    store.networkLatency = nextLatency;
    store.effectiveIsLan = effective;
  },
  { immediate: true },
);

const sidebarCollapsed = ref(true);
const isSidebarEnabled = computed(() => {
  const w = store.widgets.find((w) => w.type === "sidebar" && w.enable);
  return checkVisible(w) && !(isMobile.value && w?.hideOnMobile);
});

const toggleForceMode = () => {
  if (forceMode.value === "auto") forceMode.value = "lan";
  else if (forceMode.value === "lan") forceMode.value = "wan";
  else if (forceMode.value === "wan") forceMode.value = "latency";
  else forceMode.value = "auto";
};

const searchEngineStored = useStorage("flat-nas-engine", "bing");
// 内置引擎默认只带 Bing；Google/百度等由用户在 设置 → 搜索引擎设置 里自行添加
const engines = computed(
  () =>
    store.appConfig.searchEngines || [
      { id: "bing", key: "bing", label: "Bing", urlTemplate: "https://cn.bing.com/search?q={q}" },
    ],
);
const sessionEngine = ref<string | null>(null);
const effectiveEngine = computed({
  get: () =>
    sessionEngine.value ||
    (store.appConfig.rememberLastEngine
      ? searchEngineStored.value
      : store.appConfig.defaultSearchEngine || engines.value[0]?.key || "bing"),
  set: (val: string) => {
    sessionEngine.value = val;
    if (store.appConfig.rememberLastEngine) {
      searchEngineStored.value = val;
    }
  },
});
const searchText = ref("");
const searchInputRef = ref<HTMLInputElement | null>(null);
// 搜索结果是否用新窗口打开（持久化，默认勾选）
const searchOpenInNewTab = useStorage("flat-nas-search-newtab", true);
// 引擎切换 / 新窗口开关的弹层：默认隐藏，点搜索框左侧的引擎图标才弹出，
// 点弹层外任意位置自动收起（onClickOutside 挂在整个搜索容器上）。
const showSearchPanel = ref(false);
const searchAreaRef = ref<HTMLElement | null>(null);
onClickOutside(searchAreaRef, () => {
  showSearchPanel.value = false;
});
// 加载失败的引擎图标（favicon 取不到时回退为首字母）
const failedFavicons = reactive(new Set<string>());

// 从 urlTemplate 里解析出主机名，用站点自己的 favicon.ico 当引擎图标
// （google/bing/baidu 的 favicon.ico 都是其品牌图标，与参考样式一致）
const engineHostOf = (tpl: string) => {
  try {
    return new URL(tpl.replace("{q}", "x")).hostname;
  } catch {
    return "";
  }
};
const engineFavicon = (e: { urlTemplate: string }) => {
  const h = engineHostOf(e.urlTemplate);
  return h ? `https://${h}/favicon.ico` : "";
};
const currentEngine = computed(() =>
  engines.value.find((e) => e.key === effectiveEngine.value),
);

// 已知引擎的内联品牌图标：favicon.ico 依赖访问引擎站点本身
// （google.com 在国内网络不可达，会开天窗），内置的 SVG 永远可靠。
const GOOGLE_G_SVG =
  '<svg viewBox="0 0 24 24" style="width:100%;height:100%"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>';
const BING_B_SVG =
  '<svg viewBox="0 0 24 24" style="width:100%;height:100%"><path fill="#008373" d="M5 3v16.5l4.67 2.75 8.9-5.28v-3.9l-6.53-2.44 2.6 3.72-5.02 2.7V6.75L5 3z"/><path fill="#37c1ab" d="M5 3l4.67 3.75v4.66L5 8.9V3z" opacity=".85"/></svg>';
const BAIDU_PAW_SVG =
  '<svg viewBox="0 0 24 24" style="width:100%;height:100%"><path fill="#2932E1" d="M9.11 8.35c.78-.17 1.34-.94 1.24-1.76L10 3.9c-.1-.86-.83-1.5-1.65-1.42-.83.08-1.42.85-1.32 1.71l.35 2.7c.1.82.9 1.44 1.73 1.46zM14.06 8.5c.86 0 1.6-.68 1.68-1.5l.24-2.68c.08-.86-.53-1.62-1.36-1.68-.83-.07-1.55.57-1.63 1.43l-.24 2.68c-.08.85.48 1.6 1.31 1.75zM18.9 10.35c.74.38 1.65.1 2.05-.62l1.3-2.36c.42-.76.14-1.7-.6-2.1-.75-.4-1.66-.1-2.07.65l-1.3 2.36c-.4.74-.12 1.68.62 2.07zM6.32 9.4c.7-.44.93-1.37.5-2.1l-1.3-2.28c-.44-.72-1.37-.96-2.1-.52-.73.43-.97 1.36-.53 2.09l1.3 2.28c.44.73 1.4.97 2.13.53zM17.6 15.53c-.5-.57-2.36-1.98-3.4-2.9-1.03-.92-2.5-2.5-3.28-2.5-.78 0-2.24 1.57-3.28 2.5-1.03.92-2.9 2.33-3.4 2.9-.5.57-.9 1.4-.63 2.28.27.88 1.1 1.34 1.94 1.34h10.74c.84 0 1.67-.46 1.94-1.34.27-.88-.13-1.71-.63-2.28z"/></svg>';
const engineSvgMap: Record<string, string> = {
  google: GOOGLE_G_SVG,
  bing: BING_B_SVG,
  baidu: BAIDU_PAW_SVG,
};

const hexToRgb = (hex: string) => {
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (h.length !== 6) return null;
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

const rgbaFromHex = (hex: string, alpha: number) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
};

const searchWidget = computed(() => {
  const enabled = store.widgets.find((w) => w.type === "search" && w.enable !== false);
  if (enabled) return enabled as WidgetConfig;
  const any = store.widgets.find((w) => w.type === "search");
  return any as WidgetConfig | undefined;
});
const searchTextColor = computed(() => searchWidget.value?.textColor || "#111827");
const searchBgAlpha = computed(() => {
  const raw = searchWidget.value?.opacity;
  if (typeof raw !== "number") return 0.9;
  return Math.max(0.1, Math.min(1, raw));
});
const searchPlaceholderColor = computed(
  () => rgbaFromHex(searchTextColor.value, 0.55) || "rgba(107, 114, 128, 1)",
);

watch(
  () => store.appConfig.defaultSearchEngine,
  (newVal) => {
    if (newVal) {
      // 当默认搜索引擎改变时，重置会话选择
      sessionEngine.value = null;
      // 如果开启了"记住上次选择"，则同步更新存储的值
      if (store.appConfig.rememberLastEngine) {
        searchEngineStored.value = newVal;
      }
    }
  },
);

// --- 核心修复逻辑开始 ---
// 用于清洗 SVG 代码中的无效颜色类名，强制转为白色
const processIcon = (iconStr: string) => {
  if (!iconStr) return "";
  if (!iconStr.trim().startsWith("<svg")) return iconStr;
  let fixed = iconStr;
  const badColorRegex = /fill-[a-z]+-(50|100|200)/g;
  if (badColorRegex.test(fixed)) {
    fixed = fixed.replace(
      /class="([^"]*)\bfill-[a-z]+-(50|100|200)\b([^"]*)"/g,
      'class="$1 $3" style="fill: #ffffff;"',
    );
  }
  return fixed;
};
// --- 核心修复逻辑结束 ---

// --- Wallpaper Preload Logic ---
const isPcBgLoaded = ref(false);
const isMobileBgLoaded = ref(false);

// 外部 API 壁纸（如 Bing 每日壁纸）按天追加缓存参数：
// 每次打开网页都会拉取当天最新图片，同时同一天内可命中浏览器缓存。
const resolveWallpaperUrl = (raw: string, type: "pc" | "mobile") => {
  const url = store.getAssetUrl(raw);
  if (!/^https?:\/\//i.test(url)) return url;
  const cfg =
    type === "pc" ? store.appConfig.wallpaperConfig : store.appConfig.mobileWallpaperConfig;
  if (cfg?.enabled !== true || !cfg.url || !/^https?:\/\//i.test(cfg.url)) return url;
  const now = new Date();
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  return `${url}${url.includes("?") ? "&" : "?"}d=${day}`;
};

const pcBgUrl = computed(() =>
  store.appConfig.background ? resolveWallpaperUrl(store.appConfig.background, "pc") : "",
);
const mobileBgUrl = computed(() =>
  store.appConfig.mobileBackground
    ? resolveWallpaperUrl(store.appConfig.mobileBackground, "mobile")
    : "",
);

watch(
  pcBgUrl,
  (url) => {
    if (!url) {
      isPcBgLoaded.value = false;
      return;
    }
    const img = new Image();
    img.src = url;
    if (img.complete) {
      isPcBgLoaded.value = true;
    } else {
      isPcBgLoaded.value = false;
      img.onload = () => {
        isPcBgLoaded.value = true;
      };
      img.onerror = () => {
        isPcBgLoaded.value = true;
      };
    }
  },
  { immediate: true },
);

watch(
  mobileBgUrl,
  (url) => {
    if (!url) {
      isMobileBgLoaded.value = false;
      return;
    }
    const img = new Image();
    img.src = url;
    if (img.complete) {
      isMobileBgLoaded.value = true;
    } else {
      isMobileBgLoaded.value = false;
      img.onload = () => {
        isMobileBgLoaded.value = true;
      };
      img.onerror = () => {
        isMobileBgLoaded.value = true;
      };
    }
  },
  { immediate: true },
);
// ------------------------------

/*
const draggableWidgets = computed({
  get: () =>
    store.widgets.filter(
      (w) =>
        checkVisible(w) &&
        w.type !== "player" &&
        w.type !== "search" &&
        w.type !== "quote" &&
        w.type !== "sidebar",
    ),
  set: (newOrder: WidgetConfig[]) => {
    const hiddenWidgets = store.widgets.filter(
      (w) =>
        !checkVisible(w) ||
        w.type === "player" ||
        w.type === "search" ||
        w.type === "quote" ||
        w.type === "sidebar",
    );
    store.widgets = [...newOrder, ...hiddenWidgets];
    store.markDirty();
  },
});
*/

const layoutData = ref<GridLayoutItem[]>([]);
let skipNextLayoutSave = false;
let isInternalUpdate = false;
const isHandheld = computed(() => deviceKey.value === "mobile" || deviceKey.value === "tablet");
const checkVisible = (obj?: WidgetConfig | NavItem) => {
  if (!obj) return false;
  if ("enable" in obj && !obj.enable) return false;
  if ("hideOnMobile" in obj && obj.hideOnMobile && isMobile.value) return false;
  if (store.isLogged) return true;
  return !!obj.isPublic;
};
const isGridWidget = (widget: WidgetConfig) => gridWidgetTypes.has(widget.type);
const isTabletPortrait = computed(() => deviceKey.value === "tablet" && height.value > width.value);
const desktopWidgetAreaCols = computed(() => {
  const raw = store.appConfig.widgetAreaCols ?? store.appConfig.widgetAreaSize;
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 4;
  const clamped = Math.min(16, Math.max(0.5, n));
  if (store.isExpandedMode) return Math.min(16, Math.max(8, clamped));
  return clamped;
});
const isWideLayout = computed(
  () => deviceKey.value === "desktop" && desktopWidgetAreaCols.value > 4,
);
const mainContentMaxWidth = computed(() => {
  if (deviceKey.value !== "desktop") return undefined;
  const base = 1280;
  const maxAllowed = Math.round(width.value * 0.89);
  if (!Number.isFinite(maxAllowed) || maxAllowed <= 0) return `${base}px`;

  if (desktopWidgetAreaCols.value <= 4) {
    return `${Math.min(base, maxAllowed)}px`;
  }

  const baseColWidth = base / 4;
  const required = Math.round(baseColWidth * desktopWidgetAreaCols.value);
  const target = Math.min(required, maxAllowed);
  return `${Math.max(0, target)}px`;
});
const widgetColNum = computed(() => {
  if (deviceKey.value === "mobile") return 1;
  if (deviceKey.value === "tablet") return isTabletPortrait.value ? 2 : 4;
  return desktopWidgetAreaCols.value;
});
const lastDeviceKey = ref(deviceKey.value);
const lastWidgetColNum = ref(widgetColNum.value);
const rowHeight = computed(() =>
  deviceKey.value === "mobile" ? 120 : deviceKey.value === "tablet" ? 130 : 140,
);
const gridScale = 2;
const gridMargin = computed<[number, number]>(() => (isMobile.value ? [12, 12] : [24, 24]));
const scaledRowHeight = computed(() =>
  Math.max(1, (rowHeight.value - gridMargin.value[1]) / gridScale),
);
const scaleGridValue = (value: number) => Math.round(value * gridScale);
const unscaleGridValue = (value: number) => Math.round(value) / gridScale;
const scaledLayoutData = computed<GridLayoutItem[]>({
  get: () =>
    layoutData.value.map((item) => ({
      ...item,
      x: scaleGridValue(item.x),
      y: scaleGridValue(item.y),
      w: scaleGridValue(item.w),
      h: scaleGridValue(item.h),
    })),
  set: (next) => {
    const current = new Map(layoutData.value.map((item) => [item.i, item]));
    layoutData.value = next.map((item) => {
      const base = current.get(item.i);
      const x = unscaleGridValue(item.x);
      const y = unscaleGridValue(item.y);
      const w = unscaleGridValue(item.w);
      const h = unscaleGridValue(item.h);
      if (base) {
        return { ...base, x, y, w, h, colSpan: w, rowSpan: h };
      }
      return { ...item, x, y, w, h };
    });
  },
});

const compactVertical = (layout: GridLayoutItem[]) => {
  const step = 1 / gridScale;
  const collides = (a: GridLayoutItem, b: GridLayoutItem) =>
    a.i !== b.i && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  const canPlace = (item: GridLayoutItem, placed: GridLayoutItem[]) =>
    !placed.some((p) => collides(item, p));

  const sorted = [...layout].sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
  const placed: GridLayoutItem[] = [];
  const compacted: GridLayoutItem[] = [];

  for (const item of sorted) {
    const originalY = Math.max(0, item.y || 0);
    let next = { ...item, y: originalY };

    // 1. Try to move UP to fill gaps (vertical compaction)
    let found = false;
    // 使用 step 步进检查，确保能填充 0.5 高度的空隙
    for (let y = 0; y < originalY; y += step) {
      const candidate = { ...next, y };
      if (canPlace(candidate, placed)) {
        next = candidate;
        found = true;
        break;
      }
    }

    // 2. If not moved up, check if originalY is valid. If not, push DOWN.
    if (!found) {
      let y = originalY;
      while (true) {
        const candidate = { ...next, y };
        if (canPlace(candidate, placed)) {
          next = candidate;
          break;
        }
        y += step;
        if (y > 10000) break; // Safety break
      }
    }

    placed.push(next);
    compacted.push(next);
  }

  const byId = new Map(compacted.map((it) => [it.i, it] as const));
  return layout.map((it) => byId.get(it.i) || it);
};

watch(
  () => [store.mergedWidgets, widgetColNum.value, deviceKey.value],
  () => {
    const nextDeviceKey = deviceKey.value;
    const nextColNum = widgetColNum.value;
    const shouldRemount =
      nextDeviceKey !== lastDeviceKey.value || nextColNum !== lastWidgetColNum.value;
    lastDeviceKey.value = nextDeviceKey;
    lastWidgetColNum.value = nextColNum;

    if (isInternalUpdate) return;

    // 防止编辑时因服务端推送导致的布局回弹 (Rebound)
    // 处于编辑模式(活跃)时，忽略外部更新，以本地拖拽状态为准
    if (isEditMode.value) return;

    const visibleWidgets = store.mergedWidgets
      .filter(
        (w) =>
          checkVisible(w) &&
          isGridWidget(w) &&
          !(deviceKey.value === "mobile" && w.hideOnMobile),
      )
      .sort((a, b) => {
        // Sort by visual position (Row-major) to ensure correct reflow order
        const ay = a.y ?? 0;
        const by = b.y ?? 0;
        if (ay !== by) return ay - by;
        return (a.x ?? 0) - (b.x ?? 0);
      });

    const colNum = widgetColNum.value;

    const widgetsToLayout = visibleWidgets.map((w) => {
      const newW: WidgetConfig = { ...w };
      const layouts = newW.layouts;
      const key = deviceKey.value as "desktop" | "tablet" | "mobile";
      const spec = layouts ? layouts[key] : undefined;
      if (spec) {
        newW.x = spec.x;
        newW.y = spec.y;
        newW.w = spec.w;
        newW.h = spec.h;
        newW.colSpan = spec.w;
        newW.rowSpan = spec.h;
      } else if (deviceKey.value === "mobile") {
        // If no mobile layout exists, reset position to force auto-layout in reading order
        newW.x = undefined;
        newW.y = undefined;
      }

      // Safety: Ensure widget width does not exceed total columns
      // This is critical when switching from wider to narrower layouts (e.g. desktop -> tablet)
      if ((newW.w || 1) > colNum) newW.w = colNum;

      if (deviceKey.value === "mobile") {
        if (
          [
            "clockweather",
            "calendar",
            "rss",
            "iframe",
            "todo",
            "memo",
            "bookmarks",
            "hot",
          ].includes(newW.type)
        ) {
          newW.w = colNum;
        }
      }
      return newW;
    });

    // 标记为程序化布局更新，避免触发保存循环
    skipNextLayoutSave = true;
    layoutData.value = compactVertical(generateLayout(widgetsToLayout, colNum));
    
    // 如果 deviceKey 发生变化，强制重新挂载 GridLayout 组件
    // 这可以解决从窄屏切换回宽屏时布局错乱的问题，同时避免 :key 导致的死循环
    if (shouldRemount && !isInternalUpdate && !isEditMode.value) {
      isGridAlive.value = false;
      nextTick(() => {
        isGridAlive.value = true;
      });
    }
  },
  { deep: true, immediate: true },
);

const handleLayoutUpdated = (newLayout: GridLayoutItem[]) => {
  // 如果是程序化更新导致的事件，跳过保存
  if (skipNextLayoutSave) {
    skipNextLayoutSave = false;
    return;
  }

  const key = deviceKey.value as "desktop" | "tablet" | "mobile";

  // 如果布局与当前 store.widgets 相同，跳过保存
  let changed = false;
  for (const l of newLayout) {
    const w = store.widgets.find((sw) => sw.id === l.i);
    const spec = w?.layouts?.[key];
    const curX = spec?.x ?? w?.x;
    const curY = spec?.y ?? w?.y;
    const curW = spec?.w ?? w?.w ?? w?.colSpan ?? 1;
    const curH = spec?.h ?? w?.h ?? w?.rowSpan ?? 1;
    
    // 增强检查：在 desktop 模式下，必须确保顶层属性也一致
    const isDesktop = key === "desktop";
    const specMismatch = !w || curX !== l.x || curY !== l.y || curW !== l.w || curH !== l.h;
    const topLevelMismatch = isDesktop && w && (w.x !== l.x || w.y !== l.y || w.w !== l.w || w.h !== l.h);

    if (specMismatch || topLevelMismatch) {
      changed = true;
      break;
    }
  }
  if (!changed) return;

  isInternalUpdate = true;

  newLayout.forEach((l) => {
    const w = store.widgets.find((sw) => sw.id === l.i);
    if (w) {
      const layouts = w.layouts || {};
      const spec: { x: number; y: number; w: number; h: number } = {
        x: l.x,
        y: l.y,
        w: l.w,
        h: l.h,
      };
      layouts[key] = spec;
      w.layouts = layouts;

      if (key === "desktop") {
        w.x = l.x;
        w.y = l.y;
        w.w = l.w;
        w.h = l.h;
        w.colSpan = l.w;
        w.rowSpan = l.h;
      }
    }
  });
  store.markDirty();
  nextTick(() => {
    isInternalUpdate = false;
  });
};

const displayGroups = computed(() => {
  // ✨ 性能优化：在编辑模式且无搜索时，直接返回 store.groups 引用
  // 这样 VueDraggable 就能直接操作 store 中的数组，确保拖拽状态实时同步
  if (isEditMode.value && !searchText.value) {
    return store.groups;
  }

  return store.groups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        const isMatch =
          !searchText.value ||
          item.title.toLowerCase().includes(searchText.value.toLowerCase()) ||
          item.url.toLowerCase().includes(searchText.value.toLowerCase());
        const isVisible = checkVisible(item);
        return isMatch && isVisible;
      }),
    }))
    .filter((g) => {
      // 分组级 hideOnMobile：移动端整组隐藏（编辑模式提前返回不受影响，便于找回开关）
      if (isMobile.value && g.hideOnMobile) return false;
      if (store.isLogged) return true;
      return g.items.length > 0 || !!g.preset;
    });
});

const paginationWheelLockUntil = ref(0);
const getScrollElement = () => {
  if (typeof document === "undefined") return null;
  return (document.scrollingElement ||
    document.documentElement ||
    document.body) as HTMLElement | null;
};
const movePaginationGroup = (step: number) => {
  const groups = displayGroups.value;
  if (groups.length === 0) return;
  const ids = groups.map((g) => g.id);
  let idx = ids.indexOf(activePaginationGroupId.value);
  if (idx < 0) idx = 0;
  const nextId = ids[(idx + step + ids.length) % ids.length];
  if (nextId) activePaginationGroupId.value = nextId;
};
const handleWebPaginationWheel = (e: WheelEvent) => {
  if (!isWebPaginationMode.value) return;
  if (isEditMode.value) return;
  if (
    showEditModal.value ||
    showSettingsModal.value ||
    showGroupSettingsModal.value ||
    showLoginModal.value
  )
    return;
  if (e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (!e.deltaY) return;

  const now = Date.now();
  if (now < paginationWheelLockUntil.value) return;

  const scrollEl = getScrollElement();
  if (!scrollEl) return;

  const canScroll = scrollEl.scrollHeight - scrollEl.clientHeight > 2;
  const atTop = scrollEl.scrollTop <= 0;
  const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 1;
  const shouldPaginate = !canScroll || (e.deltaY < 0 ? atTop : atBottom);
  if (!shouldPaginate) return;

  e.preventDefault();
  e.stopPropagation();

  paginationWheelLockUntil.value = now + 320;
  if (store.appConfig.webGroupPaginationDisableFlip) return;
  movePaginationGroup(e.deltaY > 0 ? 1 : -1);
};

watch(
  [activePaginationGroupId, isWebPaginationMode],
  ([, mode]) => {
    if (!mode) return;
    nextTick(() => {
      const el = getScrollElement();
      el?.scrollTo({ top: 0 });
    });
  },
  { flush: "post" },
);

const sanitizedFooterHtml = computed(() => {
  return DOMPurify.sanitize(store.appConfig.footerHtml || "");
});

onMounted(() => {
  mainContainerRef.value?.addEventListener("wheel", handleWebPaginationWheel, { passive: false });
});

onUnmounted(() => {
  mainContainerRef.value?.removeEventListener("wheel", handleWebPaginationWheel);
});

const cycleWidgetSize = (widget: WidgetConfig) => {
  // 统一为所有组件启用 4x4 尺寸选择器
  activeResizeWidgetId.value = activeResizeWidgetId.value === widget.id ? null : widget.id;
};

let widgetHandlePointerId: number | null = null;
let widgetHandleStartX = 0;
let widgetHandleStartY = 0;
const suppressNextWidgetHandleClick = ref(false);

const onWidgetHandlePointerDown = (e: PointerEvent) => {
  if (!isHandheld.value) return;
  widgetHandlePointerId = e.pointerId;
  widgetHandleStartX = e.clientX;
  widgetHandleStartY = e.clientY;
  suppressNextWidgetHandleClick.value = false;
};

const onWidgetHandlePointerMove = (e: PointerEvent) => {
  if (!isHandheld.value) return;
  if (widgetHandlePointerId === null || e.pointerId !== widgetHandlePointerId) return;
  const dx = e.clientX - widgetHandleStartX;
  const dy = e.clientY - widgetHandleStartY;
  if (dx * dx + dy * dy > 64) suppressNextWidgetHandleClick.value = true;
};

const onWidgetHandlePointerUp = (e: PointerEvent) => {
  if (!isHandheld.value) return;
  if (widgetHandlePointerId === null || e.pointerId !== widgetHandlePointerId) return;
  widgetHandlePointerId = null;
};

const onWidgetHandleClick = (widget: WidgetConfig) => {
  if (isHandheld.value && suppressNextWidgetHandleClick.value) {
    suppressNextWidgetHandleClick.value = false;
    return;
  }
  cycleWidgetSize(widget);
};

const handleSizeSelect = (widget: GridLayoutItem, size: { colSpan: number; rowSpan: number }) => {
  const maxCols = deviceKey.value === "mobile" ? 2 : Math.min(4, widgetColNum.value);
  const maxRows = 4;
  const min = 0.5;
  const normalize = (value: number) => Math.round(value * 2) / 2;
  const nextW = Math.min(Math.max(normalize(size.colSpan), min), maxCols);
  const nextH = Math.min(Math.max(normalize(size.rowSpan), min), maxRows);

  widget.w = nextW;
  widget.h = nextH;
  widget.colSpan = nextW;
  widget.rowSpan = nextH;

  // Manually trigger layout compaction to resolve collisions
  const newLayout = compactVertical(layoutData.value);
  layoutData.value = newLayout;

  // Sync back to store (all widgets, not just the resized one)
  handleLayoutUpdated(newLayout);

  activeResizeWidgetId.value = null;
};

const handleScaledLayoutUpdated = (newLayout: GridLayoutItem[]) => {
  const unscaled = newLayout.map((item) => ({
    ...item,
    x: unscaleGridValue(item.x),
    y: unscaleGridValue(item.y),
    w: unscaleGridValue(item.w),
    h: unscaleGridValue(item.h),
  }));

  // Enforce custom compaction logic (0.5 unit support)
  // This ensures the layout is consistent with what will be loaded after refresh
  const compacted = compactVertical(unscaled);

  // Check if layout actually changed to avoid recursive updates
  const isChanged =
    layoutData.value.length !== compacted.length ||
    layoutData.value.some((item) => {
      const match = compacted.find((c) => c.i === item.i);
      if (!match) return true;
      return (
        match.x !== item.x ||
        match.y !== item.y ||
        match.w !== item.w ||
        match.h !== item.h
      );
    });

  // Update local layout data only when different to avoid redundant writes
  if (isChanged) {
    layoutData.value = compacted;
  }
  // Always sync to store so drag result is persisted (setter may have updated layoutData already, so isChanged can be false)
  handleLayoutUpdated(compacted);
};

const isEmpireCloudWidget = (type: string) => {
  return ["bookmarks", "countdown", "rss", "todo", "calendar", "hot"].includes(type);
};

const devtoolsClickCount = ref(0);
const devtoolsClickTimer = ref<number | null>(null);

const closeResizeSelector = () => {
  activeResizeWidgetId.value = null;
};

onMounted(() => {
  document.addEventListener("click", closeResizeSelector);
});

onUnmounted(() => {
  document.removeEventListener("click", closeResizeSelector);
});

const toggleDevTools = () => {
  const style = document.getElementById("devtools-hider");
  if (style) {
    style.remove();
  } else {
    const newStyle = document.createElement("style");
    newStyle.id = "devtools-hider";
    newStyle.innerHTML = `
      #vue-devtools-anchor,
      .vue-devtools__anchor,
      .vue-devtools__trigger,
      [data-v-inspector-toggle] {
        display: none !important;
      }
    `;
    document.head.appendChild(newStyle);
  }
};

const handleNetworkClick = async () => {
  checkLatency();

  const now = Date.now();
  if (!devtoolsClickTimer.value) {
    devtoolsClickTimer.value = now;
    devtoolsClickCount.value = 1;
  } else {
    if (now - devtoolsClickTimer.value > 5000) {
      devtoolsClickTimer.value = now;
      devtoolsClickCount.value = 1;
    } else {
      devtoolsClickCount.value++;
    }
  }

  if (devtoolsClickCount.value >= 10) {
    toggleDevTools();
    devtoolsClickCount.value = 0;
    devtoolsClickTimer.value = null;
  }
};

const fetchWithTimeout = (input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 500) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    window.clearTimeout(timer);
  });
};

const checkLatency = async () => {
  try {
    if (isChecking.value) return;
    isChecking.value = true;
    const samples: number[] = [];
    for (let i = 0; i < 2; i++) {
      const start = performance.now();
      try {
        const res = await fetchWithTimeout(
          `/api/rtt?ts=${Date.now()}`,
          { method: "GET", cache: "no-store" },
          500,
        );
        await res.json().catch(() => null);
        samples.push(Math.round(performance.now() - start));
      } catch {
        if (forceMode.value === "latency") {
          forceMode.value = "auto";
        }
      }
      if (i === 0) {
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    }
    latency.value = samples.length > 0 ? Math.min(...samples) : 0;

    if (latency.value > 0) {
      const cfg = networkConfig.value;
      const result = computeEffectiveNetworkMode(
        window.location.hostname,
        lastKnownClientIp.value,
        lastKnownClientIpSource.value,
        latency.value,
        {
          internalDomains: cfg.internalDomains,
          networkRules: cfg.networkRules,
          forceNetworkMode: cfg.forceNetworkMode,
          latencyThresholdMs: cfg.latencyThresholdMs,
        },
      );
      isLanMode.value = result.isLan;
    }
  } finally {
    isChecking.value = false;
  }
};

watch(forceMode, (val) => {
  if (val === "latency") {
    checkLatency();
  }
  if (store.isLanModeInited) {
    const cfg = networkConfig.value;
    const result = computeEffectiveNetworkMode(
      window.location.hostname,
      lastKnownClientIp.value,
      lastKnownClientIpSource.value,
      latency.value,
      {
        internalDomains: cfg.internalDomains,
        networkRules: cfg.networkRules,
        forceNetworkMode: cfg.forceNetworkMode,
        latencyThresholdMs: cfg.latencyThresholdMs,
      },
    );
    isLanMode.value = result.isLan;
  }
});
watch(latencyThresholdMs, () => {
  if (forceMode.value === "latency") {
    checkLatency();
  } else if (store.isLanModeInited) {
    const cfg = networkConfig.value;
    const result = computeEffectiveNetworkMode(
      window.location.hostname,
      lastKnownClientIp.value,
      lastKnownClientIpSource.value,
      latency.value,
      {
        internalDomains: cfg.internalDomains,
        networkRules: cfg.networkRules,
        forceNetworkMode: cfg.forceNetworkMode,
        latencyThresholdMs: cfg.latencyThresholdMs,
      },
    );
    isLanMode.value = result.isLan;
  }
});

onMounted(() => {
  const cfg = networkConfig.value;
  const initialResult = computeEffectiveNetworkMode(
    window.location.hostname,
    "",
    "",
    0,
    {
      internalDomains: cfg.internalDomains,
      networkRules: cfg.networkRules,
      forceNetworkMode: cfg.forceNetworkMode,
      latencyThresholdMs: cfg.latencyThresholdMs,
    },
  );
  isLanMode.value = initialResult.isLan;
  setTimeout(() => checkLatency(), 2000);
  fetchIp(true);
  ipInterval = window.setInterval(() => fetchIp(), 3600000);
  const ensureSearchFocus = () => {
    nextTick(() => {
      if (searchInputRef.value) {
        searchInputRef.value.focus();
      } else {
        setTimeout(ensureSearchFocus, 200);
      }
    });
  };
  ensureSearchFocus();
});

let gridPostInitReady = false;
watch(
  () => store.isClientReady,
  (ready) => {
    if (!ready || gridPostInitReady) return;
    gridPostInitReady = true;
    store.cleanInvalidGroups();
    normalizeDivCardWidgets();
  },
  { immediate: true },
);

const doSearch = () => {
  if (!searchText.value) return;
  const eng = engines.value.find((e) => e.key === effectiveEngine.value);
  const template = eng?.urlTemplate || "https://cn.bing.com/search?q={q}";
  const url = template.replace("{q}", encodeURIComponent(searchText.value));
  if (searchOpenInNewTab.value) {
    window.open(url, "_blank");
  } else {
    window.location.href = url;
  }
  searchText.value = "";
};

const openAddModal = (groupId: string) => {
  // 系统状态分组："+" 直接新建 CPU/内存/磁盘状态卡（默认磁盘类型）
  const group = store.groups.find((g) => g.id === groupId);
  if (group && isSysStatGroup(group)) {
    sysStatCreateGroupId.value = groupId;
    sysStatEditItem.value = {
      id: "",
      title: "磁盘",
      url: "",
      icon: "",
      isPublic: true,
      sysStat: { kind: "disk" },
    };
    showSysStatEditModal.value = true;
    return;
  }
  currentEditItem.value = null;
  currentGroupId.value = groupId;
  showEditModal.value = true;
};
const openEditModal = (item: NavItem, groupId?: string) => {
  currentEditItem.value = item;
  if (groupId) {
    currentGroupId.value = groupId;
  }
  showEditModal.value = true;
};
const handleSave = async (payload: { item: NavItem; groupId?: string }) => {
  // Check if it's a div-card widget update
  const widget = store.widgets.find((w) => w.id === payload.item.id && w.type === "div-card");
  if (widget) {
    // Merge all properties from the edited item back into widget.data
    // This ensures icon, url, background, etc. are saved
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...dataProps } = payload.item;
    widget.data = {
      ...widget.data,
      ...dataProps,
    };
    store.markDirty();
  } else {
    if (payload.item.id) {
      // Check for group move
      const targetGroupId = payload.groupId;
      let moved = false;
      
      if (targetGroupId) {
        const currentGroup = store.groups.find(g => g.items.some(i => i.id === payload.item.id));
        if (currentGroup && currentGroup.id !== targetGroupId) {
          // Move item: remove from old group, add to new group
          store.deleteItem(payload.item.id);
          store.addItem(payload.item, targetGroupId);
          moved = true;
        }
      }
      
      if (!moved) {
        store.updateItem(payload.item);
      }
    } else if (payload.groupId) {
      store.addItem({ ...payload.item, id: Date.now().toString() }, payload.groupId);
    }
  }

  const result = await store.saveData(true);
  if (result === "conflict" || result === "unauthorized") {
    throw new Error(`保存失败：${result === "conflict" ? "发生版本冲突" : "未授权或登录已过期"}`);
  }
};
const normalizeGridSpan = (value: number) => Math.round(value * 2) / 2;
const getDivCardDefaultSize = () => {
  const maxCols = widgetColNum.value;
  const w = Math.max(0.5, Math.min(maxCols, normalizeGridSpan(0.5)));
  return { w, h: 1 };
};
const normalizeDivCardWidgets = () => {
  let changed = false;
  const { w: defaultW, h: defaultH } = getDivCardDefaultSize();
  store.widgets.forEach((widget) => {
    if (widget.type !== "div-card") return;
    const nextW = widget.w ?? widget.colSpan ?? defaultW;
    const nextH = widget.h ?? widget.rowSpan ?? defaultH;
    const finalW = nextW > 0 ? nextW : defaultW;
    const finalH = nextH > 0 ? nextH : defaultH;
    if (
      widget.w !== finalW ||
      widget.h !== finalH ||
      widget.colSpan !== finalW ||
      widget.rowSpan !== finalH
    ) {
      widget.w = finalW;
      widget.h = finalH;
      widget.colSpan = finalW;
      widget.rowSpan = finalH;
      changed = true;
    }
  });
  if (changed) store.markDirty();
};
const addDivCardWidget = () => {
  const newId = `div-card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { w, h } = getDivCardDefaultSize();
  const newWidget: WidgetConfig = {
    id: newId,
    type: "div-card",
    enable: true,
    isPublic: true,
    w,
    h,
    colSpan: w,
    rowSpan: h,
    data: {
      title: "div 卡片",
      iconSize: 180,
    },
  };
  
  store.widgets.push(newWidget);

  // Manually update layoutData because the watcher is disabled in edit mode
  const currentLayout = [...layoutData.value];
  const newLayoutItem = { 
    ...newWidget, 
    i: newWidget.id, 
    x: 0, // Initial X (will be fixed by layout logic)
    y: Infinity, // Put at bottom initially
    w, 
    h 
  };
  
  // Use generateLayout + compactVertical to find the correct position
  const updatedLayout = compactVertical(generateLayout([...currentLayout, newLayoutItem], widgetColNum.value));
  
  layoutData.value = updatedLayout;
  
  // Sync the calculated position back to the widget in store
  handleLayoutUpdated(updatedLayout);
  
  store.markDirty();
};
const handleDivCardClick = (widget: WidgetConfig) => {
  if (isEditMode.value) {
    // Edit mode: Disable click to avoid conflict with drag
    // User can use right-click context menu to edit/add
    return;
  }

  // View mode: Open URL if available
  if (widget.data) {
    const item: NavItem = {
      id: widget.id,
      title: widget.data.title || "div 卡片",
      url: widget.data.url || "",
      ...widget.data,
    };
    handleCardClick(item);
  }
};
const deleteDivCardWidget = (id: string) => {
  store.widgets = store.widgets.filter((w) => w.id !== id);
  layoutData.value = layoutData.value.filter((w) => w.i !== id && w.id !== id);
  if (activeResizeWidgetId.value === id) activeResizeWidgetId.value = null;
  const newLayout = compactVertical(layoutData.value);
  layoutData.value = newLayout;
  handleLayoutUpdated(newLayout);
  store.markDirty();
};

// --- Heartbeat / Polling Mechanism for Layout ---
// Active (Edit Mode): Stop polling to prevent interference.
// Inactive (View Mode): Poll to keep in sync.
const { pause: pausePolling, resume: resumePolling } = useIntervalFn(
  async () => {
    if (
      store.isLogged &&
      !isEditMode.value &&
      !showSettingsModal.value &&
      !showGroupSettingsModal.value &&
      !showEditModal.value &&
      !showLoginModal.value
    ) {
      await store.fetchData();
    }
  },
  30000,
  { immediate: false },
);

const shouldPausePolling = computed(
  () =>
    isEditMode.value ||
    showSettingsModal.value ||
    showGroupSettingsModal.value ||
    showEditModal.value ||
    showLoginModal.value,
);

watch(
  shouldPausePolling,
  (active) => {
    if (active) pausePolling();
    else resumePolling();
  },
  { immediate: true },
);

// const deleteItem = (id: string) => {
//   openDeleteConfirm(id)
// }
let skipNextCardClickId: string | null = null;
const handleCardClick = (item: NavItem) => {
  if (skipNextCardClickId === item.id) {
    skipNextCardClickId = null;
    return;
  }
  if (isEditMode.value) return;
  // 系统状态卡片（CPU/内存/磁盘）：不可点击跳转，编辑走右键菜单
  if (item.sysStat) return;

  // 逻辑优化：
  // 1. 默认使用外网链接 (item.url)
  // 2. 只有在【已登录】且【处于内网环境】且【配置了内网链接】时，才优先使用内网链接
  // 3. 支持强制切换模式
  // 4. 修复：统一使用 effectiveIsLan 判断，确保 UI 显示与跳转行为一致

  let targetUrl = item.url;

  // effectiveIsLan 已经封装了 forceMode (LAN/WAN/Latency/Auto) 的所有判断逻辑
  // 直接使用它可以保证 UI 状态（是否显示内网标识）与实际跳转逻辑的一致性
  if (store.isLogged && effectiveIsLan.value && item.lanUrl) {
    targetUrl = item.lanUrl;
  }

  // 特殊情况：如果解析出的 targetUrl 为空（说明没有外网链接），
  // 但存在内网链接（说明是因为未登录被降级了，或者是压根没配外网链接）
  // 此时如果用户未登录，则拦截并提示登录。
  if (!targetUrl && item.lanUrl && !store.isLogged) {
    showLoginModal.value = true;
    return;
  }

  // 如果确实没有链接可跳，则不做反应
  if (!targetUrl) return;

  // Lucky STUN Port Replacement
  // 当配置了 Lucky STUN 且当前访问域名与卡片链接域名一致时，自动替换端口
  // 逻辑升级 V2：
  // 1. 默认行为：只要域名一致，就认为是“同一台机器”，默认尝试替换端口（为了解决从 STUN 端口访问时，卡片仍是内网端口的问题）。
  // 2. 例外处理：如果用户显式勾选了 skipLuckyStun（禁止替换），则保持原样（用于 Plex 等其他服务）。
  const stunData = store.luckyStunData?.data;
  if (stunData?.stun === "success" && stunData?.port) {
    try {
      const urlObj = new URL(targetUrl);
      if (urlObj.hostname === window.location.hostname) {
        // 只要当前不是内网 IP 访问，就自动替换端口
        // (防止在局域网用 IP 访问时，被错误替换成公网端口导致无法访问)
        if (!isInternalNetwork(window.location.hostname)) {
          urlObj.port = String(stunData.port);
          targetUrl = urlObj.toString();
        }
      }
    } catch {
      // Ignore relative or invalid URLs
    }
  }

  window.open(targetUrl, "_blank");
};

const handleDockerAction = async (item: NavItem, action: string) => {
  if (!store.systemConfig.enableDocker) {
    return;
  }

  let containerId = item.containerId;

  // Resolve ID from name if needed
  if ((!containerId || !containerStatuses.value[containerId]) && item.containerName) {
    const resolvedId = liveContainerNamesMap.value[item.containerName];
    if (resolvedId) {
      containerId = resolvedId;
    }
  }

  if (!containerId) return;

  if (action === "update") {
    isUpdating.value.add(containerId);
  }

  try {
    const headers = store.getHeaders();
    await fetch(`/api/docker/container/${containerId}/${action}`, {
      method: "POST",
      headers,
    });
    // Optimistic update or wait for poll? For now just wait for poll or refresh if needed.
    // Ideally we should refresh status here, but status is on the card?
    // We need to fetch container status to update the card UI if we display it.
    // Let's implement status fetching for cards.
    fetchContainerStatuses();
  } catch (e) {
    console.error(`Failed to ${action} container`, e);
  } finally {
    if (action === "update") {
      isUpdating.value.delete(containerId);
      // Force refresh status after update (single delayed refresh)
      setTimeout(fetchContainerStatuses, 15000);
    }
  }
};

const containerStatuses = ref<
  Record<
    string,
    {
      state: string;
      hasUpdate?: boolean;
      stats?: {
        cpuPercent: number;
        memPercent: number;
        memUsage: number;
        netIO?: { rx: number; tx: number };
        blockIO?: { read: number; write: number };
      };
    }
  >
>({});

// Track updating containers
const isUpdating = ref<Set<string>>(new Set());

const isItemUpdating = (item: NavItem) => {
  if (!item) return false;
  // Check explicit ID
  if (item.containerId && isUpdating.value.has(item.containerId)) return true;

  // Check resolved ID
  if (item.containerName) {
    const id = liveContainerNamesMap.value[item.containerName];
    if (id && isUpdating.value.has(id)) return true;
  }
  return false;
};

const formatBytes = (bytes: number, decimals = 1) => {
  if (!bytes) return "0B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, index)).toFixed(dm)) + (sizes[index] || "B");
};

interface ContainerStatus {
  state: string;
  hasUpdate?: boolean;
  stats?: {
    cpuPercent: number;
    memPercent: number;
    memUsage: number;
    netIO?: { rx: number; tx: number };
    blockIO?: { read: number; write: number };
  };
}

interface DockerContainer {
  Id: string;
  Names: string[];
  State: string;
  hasUpdate?: boolean;
  stats?: {
    cpuPercent: number;
    memPercent: number;
    memUsage: number;
    netIO?: { rx: number; tx: number };
    blockIO?: { read: number; write: number };
  };
  [key: string]: unknown;
}

const previousStatsMap = ref<
  Record<
    string,
    {
      time: number;
      netIO?: { rx: number; tx: number };
      blockIO?: { read: number; write: number };
    }
  >
>({});

const liveContainerNamesMap = ref<Record<string, string>>({});

const getContainerStatus = (item: NavItem) => {
  if (!item) return undefined;

  // 1. Try by ID (Fastest)
  if (item.containerId && containerStatuses.value[item.containerId]) {
    return containerStatuses.value[item.containerId];
  }

  // 2. Try by Name (Fallback / No-ID case)
  if (item.containerName) {
    const id = liveContainerNamesMap.value[item.containerName];
    if (id && containerStatuses.value[id]) {
      return containerStatuses.value[id];
    }
  }

  return undefined;
};

const fetchContainerStatuses = async () => {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return;
  }

  const dockerSystemEnabled = Boolean(store.systemConfig.enableDocker);

  const hasAnyContainerItems = store.groups.some((g) =>
    g.items.some((item) => !!item.containerId || !!item.containerName),
  );
  if (!hasAnyContainerItems) {
    if (Object.keys(containerStatuses.value).length) containerStatuses.value = {};
    if (Object.keys(previousStatsMap.value).length) previousStatsMap.value = {};
    return;
  }

  const statusMap: Record<string, ContainerStatus> = {};
  const now = Date.now();

  // 0. Ensure every docker-bound item has at least a placeholder status
  store.groups.forEach((g) => {
    g.items.forEach((item) => {
      if (!item.containerId && !item.containerName) return;

      // If we only have name, we can't key by ID yet, but we will fix this in step 2
      if (item.containerId) {
        const existing = containerStatuses.value[item.containerId];
        statusMap[item.containerId] = {
          state: existing?.state || "unknown",
          stats: existing?.stats,
        };
      }
    });
  });

  // 1. Generate Mock Data for known mock containers (ALWAYS do this for testing)
  store.groups.forEach((g) => {
    g.items.forEach((item) => {
      if (item.containerId && item.containerId.startsWith("mock-")) {
        const existing = containerStatuses.value[item.containerId];
        // Simulate fluctuating stats
        const cpuPercent = Math.min(
          100,
          Math.max(0, (existing?.stats?.cpuPercent || 30) + (Math.random() - 0.5) * 20),
        );
        const memPercent = Math.min(
          100,
          Math.max(0, (existing?.stats?.memPercent || 40) + (Math.random() - 0.5) * 10),
        );
        const memUsage = (memPercent / 100) * 1024 * 1024 * 1024; // Mock 1GB limit

        // Mock IO
        const rx = Math.random() * 1024 * 1024; // 0-1MB
        const tx = Math.random() * 512 * 1024; // 0-512KB
        const read = Math.random() * 2 * 1024 * 1024; // 0-2MB
        const write = Math.random() * 1024 * 1024; // 0-1MB

        statusMap[item.containerId] = {
          state: existing?.state || "running",
          hasUpdate: existing?.hasUpdate !== undefined ? existing.hasUpdate : Math.random() > 0.7, // Demo: 30% chance of update
          stats: {
            cpuPercent,
            memPercent,
            memUsage,
            netIO: { rx, tx },
            blockIO: { read, write },
          },
        };
      }
    });
  });

  const dockerWidget = store.widgets.find((w) => w.type === "docker" || w.id === "docker");
  const dockerMockEnabled = Boolean(dockerWidget?.data && dockerWidget.data.useMock);

  if (!dockerSystemEnabled && !dockerMockEnabled) {
    if (Object.keys(containerStatuses.value).length) containerStatuses.value = {};
    if (Object.keys(previousStatsMap.value).length) previousStatsMap.value = {};
    if (Object.keys(liveContainerNamesMap.value).length) liveContainerNamesMap.value = {};
    return;
  }

  if (dockerMockEnabled) {
    store.groups.forEach((g) => {
      g.items.forEach((item) => {
        if (!item.containerId || item.containerId.startsWith("mock-")) return;
        const existing = containerStatuses.value[item.containerId];
        const cpuPercent = Math.min(
          100,
          Math.max(0, (existing?.stats?.cpuPercent || 30) + (Math.random() - 0.5) * 20),
        );
        const memPercent = Math.min(
          100,
          Math.max(0, (existing?.stats?.memPercent || 40) + (Math.random() - 0.5) * 10),
        );
        const memUsage = (memPercent / 100) * 1024 * 1024 * 1024;
        const rx = Math.random() * 1024 * 1024;
        const tx = Math.random() * 512 * 1024;
        const read = Math.random() * 2 * 1024 * 1024;
        const write = Math.random() * 1024 * 1024;
        statusMap[item.containerId] = {
          state: existing?.state || "running",
          hasUpdate: existing?.hasUpdate !== undefined ? existing.hasUpdate : Math.random() > 0.7,
          stats: {
            cpuPercent,
            memPercent,
            memUsage,
            netIO: { rx, tx },
            blockIO: { read, write },
          },
        };
      });
    });
  }

  // 2. Try to fetch real data
  // Only fetch if there are container items to update
  const hasRealDockerItems = store.groups.some((g) =>
    g.items.some(
      (item) => (item.containerId && !item.containerId.startsWith("mock-")) || item.containerName,
    ),
  );

  if (hasRealDockerItems && !dockerMockEnabled) {
    try {
      const headers = store.getHeaders();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const res = await fetch("/api/docker/containers", { headers, signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data.success) {
        const liveContainers = (data.data || []) as DockerContainer[];

        // Build Name -> ID map for fallback lookups
        const newNameMap: Record<string, string> = {};
        liveContainers.forEach((c) => {
          if (c.Names && c.Names.length) {
            c.Names.forEach((n) => {
              const cleanName = n.replace(/^\//, "");
              newNameMap[cleanName] = c.Id;
            });
          }
        });
        liveContainerNamesMap.value = newNameMap;

        let needsSave = false;
        store.groups.forEach((g) => {
          g.items.forEach((item) => {
            // Case 1: Has ID. Check if valid, or fix if invalid.
            if (item.containerId && !item.containerId.startsWith("mock-")) {
              const foundById = liveContainers.find((c) => c.Id === item.containerId);
              if (!foundById) {
                // Try to find by name (handle ID change after container recreation)
                let foundByName: DockerContainer | undefined;

                // 1. Try strict match by containerName (if set)
                if (item.containerName) {
                  foundByName = liveContainers.find((c) =>
                    (c.Names || []).some((n) => n.replace(/^\//, "") === item.containerName),
                  );
                }

                // 2. Fallback to match by item.title (legacy support or if name matches title)
                if (!foundByName && item.title) {
                  foundByName = liveContainers.find((c) =>
                    (c.Names || []).some((n) => n.replace(/^\//, "") === item.title),
                  );
                }

                if (foundByName) {
                  console.log(
                    `[Docker Fix] Container ID changed. Updating ${item.containerId} -> ${foundByName.Id} (Name: ${foundByName.Names?.[0]})`,
                  );
                  item.containerId = foundByName.Id;

                  // Ensure containerName is synced to the real container name
                  // This ensures future updates work even if user renames the card title
                  const realName = (foundByName.Names?.[0] || "").replace(/^\//, "");
                  if (realName && item.containerName !== realName) {
                    item.containerName = realName;
                  }

                  needsSave = true;
                }
              }
            }
            // Case 2: No ID (or mock ID), but has Name. Try to bind.
            else if (
              (!item.containerId || item.containerId.startsWith("mock-")) &&
              item.containerName
            ) {
              const foundByName = liveContainers.find((c) =>
                (c.Names || []).some((n) => n.replace(/^\//, "") === item.containerName),
              );

              if (foundByName) {
                console.log(
                  `[Docker Bind] Found container by name. Binding ${item.containerName} -> ${foundByName.Id}`,
                );
                item.containerId = foundByName.Id;
                needsSave = true;
              }
            }
          });
        });

        if (needsSave) {
          store.markDirty();
        }

        liveContainers.forEach((c) => {
          let stats = c.stats;

          if (stats && stats.netIO && stats.blockIO) {
            // 正常路径：后端返回的是累计值，与上次差分算出速率
            const prev = previousStatsMap.value[c.Id];
            const currentNetRx = stats.netIO.rx || 0;
            const currentNetTx = stats.netIO.tx || 0;
            const currentBlockRead = stats.blockIO.read || 0;
            const currentBlockWrite = stats.blockIO.write || 0;

            let rxRate = 0;
            let txRate = 0;
            let readRate = 0;
            let writeRate = 0;

            if (prev) {
              const dt = (now - prev.time) / 1000;
              if (dt > 0) {
                rxRate = Math.max(0, (currentNetRx - (prev.netIO?.rx || 0)) / dt);
                txRate = Math.max(0, (currentNetTx - (prev.netIO?.tx || 0)) / dt);
                readRate = Math.max(0, (currentBlockRead - (prev.blockIO?.read || 0)) / dt);
                writeRate = Math.max(0, (currentBlockWrite - (prev.blockIO?.write || 0)) / dt);
              }
            }

            previousStatsMap.value[c.Id] = {
              time: now,
              netIO: { rx: currentNetRx, tx: currentNetTx },
              blockIO: { read: currentBlockRead, write: currentBlockWrite },
            };

            stats = {
              ...stats,
              netIO: { rx: rxRate, tx: txRate },
              blockIO: { read: readRate, write: writeRate },
            };
          } else if (!stats) {
            // 后端本次响应没带 stats（异步采集未完成/失败）：沿用上一次的数据，
            // 避免卡片先闪 CPU:-- RAM:-- 再等下一轮才恢复（2026-09-18）
            stats = containerStatuses.value[c.Id]?.stats;
          }

          statusMap[c.Id] = {
            state: c.State,
            hasUpdate: c.hasUpdate,
            stats: stats,
          };
        });
      }
    } catch {
      // ignore
    } finally {
      // ignore
    }
  }

  // 3. Update State
  containerStatuses.value = { ...containerStatuses.value, ...statusMap };
  // Next poll is driven by dashboard pulse (store), no self-scheduling here.
};

const isMounted = ref(false);

const handleContainerVisibilityChange = () => {
  if (!isMounted.value) return;
  if (document.visibilityState === "hidden") return;
  fetchContainerStatuses();
};

onMounted(() => {
  isMounted.value = true;
  store.registerDashboardPulse(fetchContainerStatuses);
  fetchContainerStatuses();
  document.addEventListener("visibilitychange", handleContainerVisibilityChange);
});

onUnmounted(() => {
  isMounted.value = false;
  store.unregisterDashboardPulse(fetchContainerStatuses);
  document.removeEventListener("visibilitychange", handleContainerVisibilityChange);
});

// 监听 store.groups 变化，一旦出现容器组件，立即拉一次状态（之后由脉冲每 15s 驱动）
watch(
  () => store.groups,
  () => {
    const hasAny = store.groups.some((g) =>
      g.items.some((item) => !!item.containerId || !!item.containerName),
    );
    if (hasAny && isMounted.value && document.visibilityState !== "hidden") {
      fetchContainerStatuses();
    }
  },
  { deep: true },
);

const handleAuthAction = async () => {
  if (store.isLogged) {
    const wasEditing = isEditMode.value;
    isEditMode.value = false;
    if (wasEditing) {
      try {
        await store.saveData(true);
      } finally {
        store.layoutEditInProgress = false;
      }
    }
    store.logout();
  } else {
    showLoginModal.value = true;
  }
};
const openSettings = () => {
  if (!store.isLogged) {
    showLoginModal.value = true;
  } else {
    showSettingsModal.value = true;
  }
};
const openEditOrLogin = () => {
  if (!store.isLogged) {
    showLoginModal.value = true;
  } else {
    toggleEditMode();
  }
};

// const updateGroupName = (id: string, e: Event) => {
//   const val = (e.target as HTMLElement).innerText
//   store.updateGroupTitle(id, val)
// }

const onGroupItemsChange = (groupId: string, newItems: NavItem[]) => {
  const group = store.groups.find((g) => g.id === groupId);
  if (group) {
    group.items = newItems;
  }
};

const openBackupUrl = (url: string | { url: string }) => {
  const target = typeof url === "string" ? url : url.url;
  if (!target) return;
  window.open(target, "_blank");
};

// --- Context Menu Logic ---
const showContextMenu = ref(false);
const contextMenuPosition = ref({ x: 0, y: 0 });
const contextMenuItem = ref<NavItem | null>(null);
const contextMenuGroupId = ref<string | undefined>(undefined);
let ignoreNextNativeContextMenu = false;

const openContextMenuAt = (x: number, y: number, item: NavItem, groupId?: string) => {
  if (!store.isLogged) return;
  contextMenuItem.value = item;
  contextMenuGroupId.value = groupId;

  // Prevent menu from going off-screen (basic logic)
  const menuWidth = 150;
  const menuHeight = 100;
  let finalX = x;
  let finalY = y;

  if (finalX + menuWidth > window.innerWidth) finalX -= menuWidth;
  if (finalY + menuHeight > window.innerHeight) finalY -= menuHeight;

  contextMenuPosition.value = { x: finalX, y: finalY };
  showContextMenu.value = true;
};

const openContextMenu = (e: MouseEvent, item: NavItem, groupId?: string) => {
  if (!store.isLogged) return;
  e.preventDefault();
  openContextMenuAt(e.clientX, e.clientY, item, groupId);
};

const hasTouch = computed(() => {
  if (typeof navigator === "undefined") return false;
  const n = navigator as Navigator & { msMaxTouchPoints?: number };
  const maxPoints = Math.max(0, n.maxTouchPoints || 0, n.msMaxTouchPoints || 0);
  if (maxPoints > 0) return true;
  return typeof window !== "undefined" && "ontouchstart" in window;
});
const enableLongPressContextMenu = computed(() => hasTouch.value);
let cardLongPressTimer: number | null = null;
let cardLongPressStartX = 0;
let cardLongPressStartY = 0;
let cardLongPressItem: NavItem | null = null;
let cardLongPressGroupId: string | undefined;
let cardLongPressSource: "touch" | "pointer" | null = null;

const clearCardLongPress = () => {
  if (cardLongPressTimer) window.clearTimeout(cardLongPressTimer);
  cardLongPressTimer = null;
  cardLongPressItem = null;
  cardLongPressGroupId = undefined;
  cardLongPressSource = null;
};

const onCardTouchStart = (e: TouchEvent, item: NavItem, groupId?: string) => {
  if (!store.isLogged) return;
  if (!enableLongPressContextMenu.value) return;
  if (showContextMenu.value) return;
  if (cardLongPressSource === "pointer") return;

  const t = e.touches && e.touches[0];
  if (!t) return;

  clearCardLongPress();
  cardLongPressSource = "touch";
  cardLongPressStartX = t.clientX;
  cardLongPressStartY = t.clientY;
  cardLongPressItem = item;
  cardLongPressGroupId = groupId;
  cardLongPressTimer = window.setTimeout(() => {
    if (!cardLongPressItem) return;
    skipNextCardClickId = cardLongPressItem.id;
    openContextMenuAt(
      cardLongPressStartX,
      cardLongPressStartY,
      cardLongPressItem,
      cardLongPressGroupId,
    );
    clearCardLongPress();
  }, 520);
};

const onCardTouchMove = (e: TouchEvent) => {
  if (!cardLongPressTimer) return;
  if (cardLongPressSource !== "touch") return;
  const t = e.touches && e.touches[0];
  if (!t) return;
  const dx = t.clientX - cardLongPressStartX;
  const dy = t.clientY - cardLongPressStartY;
  if (dx * dx + dy * dy > 256) clearCardLongPress();
};

const onCardTouchEnd = () => {
  clearCardLongPress();
};

const onCardPointerDown = (e: PointerEvent, item: NavItem, groupId?: string) => {
  if (!store.isLogged) return;
  if (!enableLongPressContextMenu.value) return;
  if (showContextMenu.value) return;
  if (e.pointerType !== "touch") return;

  clearCardLongPress();
  cardLongPressSource = "pointer";
  cardLongPressStartX = e.clientX;
  cardLongPressStartY = e.clientY;
  cardLongPressItem = item;
  cardLongPressGroupId = groupId;
  cardLongPressTimer = window.setTimeout(() => {
    if (!cardLongPressItem) return;
    skipNextCardClickId = cardLongPressItem.id;
    openContextMenuAt(
      cardLongPressStartX,
      cardLongPressStartY,
      cardLongPressItem,
      cardLongPressGroupId,
    );
    clearCardLongPress();
  }, 520);
};

const onCardPointerMove = (e: PointerEvent) => {
  if (!cardLongPressTimer) return;
  if (cardLongPressSource !== "pointer") return;
  if (e.pointerType !== "touch") return;
  const dx = e.clientX - cardLongPressStartX;
  const dy = e.clientY - cardLongPressStartY;
  if (dx * dx + dy * dy > 256) clearCardLongPress();
};

const onCardPointerUp = () => {
  clearCardLongPress();
};

const handleDivCardContextMenu = (e: MouseEvent, widget: WidgetConfig) => {
  if (!store.isLogged) return;
  e.preventDefault();

  const proxyItem: NavItem = {
    id: widget.id,
    title: widget.data?.title || "div 卡片",
    url: widget.data?.url || "", // Ensure it has a URL field so it's treated as a link item
    ...widget.data,
  };

  contextMenuItem.value = proxyItem;
  contextMenuGroupId.value = undefined;
  openContextMenu(e, proxyItem, undefined);
};

const handleDivCardContextMenuPointerDown = (e: MouseEvent, widget: WidgetConfig) => {
  if (!store.isLogged) return;
  ignoreNextNativeContextMenu = true;
  handleDivCardContextMenu(e, widget);
};

const handleContextMenu = (e: MouseEvent, item: NavItem, groupId?: string) => {
  if (!store.isLogged) return;
  if (ignoreNextNativeContextMenu && e.type === "contextmenu") {
    ignoreNextNativeContextMenu = false;
    e.preventDefault();
    return;
  }
  openContextMenu(e, item, groupId);
};

const handleContextMenuPointerDown = (e: MouseEvent, item: NavItem, groupId?: string) => {
  if (!store.isLogged) return;
  ignoreNextNativeContextMenu = true;
  openContextMenu(e, item, groupId);
};

const closeContextMenu = () => {
  showContextMenu.value = false;
};

const onDocPointerDownCapture = (e: PointerEvent) => {
  if (!showContextMenu.value) return;
  if (e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest?.("[data-grid-context-menu]")) return;
  closeContextMenu();
};

const handleMenuLanOpen = () => {
  const item = contextMenuItem.value;
  closeContextMenu();

  if (!item || !item.lanUrl) return;

  // 内网访问依然需要登录权限
  if (!store.isLogged) {
    showLoginModal.value = true;
    return;
  }

  window.open(item.lanUrl, "_blank");
};

const handleMenuWanOpen = () => {
  const item = contextMenuItem.value;
  closeContextMenu();
  if (!item || !item.url) return;
  window.open(item.url, "_blank");
};

const handleMenuOpen = (url: string | { url: string }) => {
  closeContextMenu();
  const target = typeof url === "string" ? url : url.url;
  if (!target) return;
  window.open(target, "_blank");
};

// 系统状态卡片编辑弹窗
const showSysStatEditModal = ref(false);
const sysStatEditItem = ref<NavItem | null>(null);
// 非空表示处于"新建卡片"模式：值为目标分组 id
const sysStatCreateGroupId = ref<string | null>(null);

const handleSysStatSave = async (payload: {
  item: NavItem;
  sysStat: NavItem["sysStat"];
  isPublic?: boolean;
}) => {
  if (!payload.sysStat) return;
  const isPublic = payload.isPublic ?? payload.item.isPublic ?? true;
  if (sysStatCreateGroupId.value) {
    // 新建：把卡片加进系统状态分组
    const gid = sysStatCreateGroupId.value;
    sysStatCreateGroupId.value = null;
    store.addItem({ ...payload.item, id: Date.now().toString(), sysStat: payload.sysStat, isPublic }, gid);
  } else {
    store.updateItem({ ...payload.item, sysStat: payload.sysStat, isPublic });
  }
  try {
    const result = await store.saveData(true);
    if (result === "conflict" || result === "unauthorized") {
      alert(`保存失败：${result === "conflict" ? "发生版本冲突" : "未授权或登录已过期"}`);
    }
  } catch {
    alert("保存失败，请重试");
  }
};

// 弹窗关闭时清掉新建模式标记
const handleSysStatModalClose = (v: boolean) => {
  showSysStatEditModal.value = v;
  if (!v) sysStatCreateGroupId.value = null;
};

const handleMenuEdit = () => {
  const item = contextMenuItem.value;
  if (item?.sysStat) {
    sysStatEditItem.value = item;
    showSysStatEditModal.value = true;
  } else if (item) {
    openEditModal(item, contextMenuGroupId.value);
  }
  closeContextMenu();
};

const handleMenuDelete = () => {
  const item = contextMenuItem.value;
  closeContextMenu();
  if (item) {
    openDeleteConfirm(item.id);
  }
};

// --- Delete Confirmation Logic ---
const showDeleteConfirm = ref(false);
const deleteType = ref<"item" | "group">("item");
const itemToDelete = ref<string | null>(null);
const groupToDelete = ref<string | null>(null);

const openDeleteConfirm = (id: string) => {
  deleteType.value = "item";
  itemToDelete.value = id;
  showDeleteConfirm.value = true;
};

const openGroupDeleteConfirm = (id: string) => {
  deleteType.value = "group";
  groupToDelete.value = id;
  showDeleteConfirm.value = true;
};

const confirmDelete = async () => {
  if (deleteType.value === "item" && itemToDelete.value) {
    const isDivCard = store.widgets.some((w) => w.id === itemToDelete.value && w.type === "div-card");
    if (isDivCard) {
      deleteDivCardWidget(itemToDelete.value);
    } else {
      store.deleteItem(itemToDelete.value);
    }
  } else if (deleteType.value === "group" && groupToDelete.value) {
    store.deleteGroup(groupToDelete.value, true);
  }
  showDeleteConfirm.value = false;
  itemToDelete.value = null;
  groupToDelete.value = null;
  try {
    const result = await store.saveData(true);
    if (result === "conflict" || result === "unauthorized") {
      alert(`删除已执行，但保存失败：${result === "conflict" ? "发生版本冲突" : "未授权或登录已过期"}`);
    }
  } catch {
    alert("删除已执行，但保存失败，请重试");
  }
};

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDownCapture, true);
  document.addEventListener("scroll", closeContextMenu, true);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointerDownCapture, true);
  document.removeEventListener("scroll", closeContextMenu, true);
  if (ipInterval) {
    clearInterval(ipInterval);
    ipInterval = null;
  }
});

// --- Group Settings ---
const activeGroupId = ref<string | null>(null);

const toggleGroupSettings = (id: string) => {
  activeGroupId.value = id;
  showGroupSettingsModal.value = true;
};

const checkMove = () => {
  return true;
};

const onGroupDragEnd = (evt: any) => {
  const oldIndex = evt.oldIndex as number;
  const newIndex = evt.newIndex as number;
  if (oldIndex !== newIndex) {
    store.reorderGroups(oldIndex, newIndex);
    store.markDirty();
  }
};

// 横向卡片的最小宽度基准（原为 220）。
// 电脑端把行列间距放大到 2 倍后，若基准仍是 220，同一宽度下每行能放的卡片数会变少、
// 每张卡片反而被 1fr 撑得更宽，右侧留出一大片空白。收窄到 196 后可维持每行的卡片数量，
// 卡片宽度回到 ~200px，内容基本填满卡片。
// 手机端不受影响：≤768px 由样式块 §6 强制两列，minWidth 不参与计算。
const H_CARD_MIN_WIDTH_BASE = 196;

// 系统状态分组：全部由 CPU/内存/磁盘卡组成。
// 这类分组强制按"横向卡片"计算布局（宽度轨道/高度/间距都和普通横向卡片一致），
// 不再受全局竖版布局、全局"无卡片背景"缩放（×0.6）影响——
// 之前系统状态卡显示得又窄又矮，就是因为分组继承了这些全局设置。
const isSysStatGroup = (group: NavGroup) =>
  group.items.length > 0 && group.items.every((it) => !!it.sysStat);

const isHorizontalGroup = (group: NavGroup) =>
  isSysStatGroup(group) || (group.cardLayout || store.appConfig.cardLayout) === "horizontal";

// 卡片容器背景：系统状态卡自定义了 bgColor 时直接用该色（单层，
// 避免"普通卡白底 + 内层深色"叠加出更黑的层）；其余走普通卡背景链。
const cardBackgroundColor = (group: NavGroup, item: NavItem) => {
  if ((group.showCardBackground ?? store.appConfig.showCardBackground) === false) {
    return "transparent";
  }
  if (item.sysStat?.bgColor) return item.sysStat.bgColor;
  return group.cardBgColor || store.appConfig.cardBgColor || "var(--card-bg-color)";
};

const getLayoutConfig = (group: NavGroup) => {
  const showBg = group.showCardBackground ?? store.appConfig.showCardBackground;
  const isHorizontal = isHorizontalGroup(group);
  const isNoBg = isSysStatGroup(group) ? false : showBg === false;

  const baseGap = group.gridGap || store.appConfig.gridGap;
  const gap = isNoBg ? Math.max(4, Math.round(baseGap * 0.6)) : baseGap;

  const baseSize = group.cardSize || store.appConfig.cardSize || 120;
  const ratio = baseSize / 120;

  const modeScale = isNoBg ? 0.6 : 1.0;
  const finalScale = ratio * modeScale;

  // Icon Size Logic
  const customIconSize = group.iconSize || store.appConfig.iconSize;
  let v_icon, h_icon;

  if (customIconSize) {
    // If explicit icon size is set, use it as base
    // Optimization: In vertical mode without card background, use the custom size directly
    if (isNoBg && !isHorizontal) {
      v_icon = customIconSize;
    } else {
      v_icon = customIconSize * modeScale;
    }
    h_icon = customIconSize * (40 / 48) * modeScale;
  } else {
    // Legacy behavior: scale with card size
    v_icon = 48 * finalScale;
    h_icon = 40 * finalScale;
  }

  let v_w = 120 * finalScale;
  let v_h = 128 * finalScale;

  // Optimization: Ensure container fits the icon in vertical no-bg mode
  if (isNoBg && !isHorizontal) {
    if (v_icon > v_w) v_w = v_icon + 8;
    const minH = v_icon + 32; // Icon + Text space
    if (minH > v_h) v_h = minH;
  }

  const h_w = H_CARD_MIN_WIDTH_BASE * finalScale;
  const h_h = 80 * finalScale;

  return {
    minWidth: isHorizontal ? h_w : v_w,
    height: isHorizontal ? h_h : v_h,
    iconSize: isHorizontal ? h_icon : v_icon,
    gap,
  };
};

// Close settings when clicking outside
// Note: In a real app we might use onClickOutside from @vueuse/core on the menu ref,
// but here we can just rely on the fact that clicking elsewhere (if not stopped) handles it?
// Actually, a global click listener or backdrop is safer.
// For now, let's use a simple window click listener or just rely on the toggle.
// Better: Use a transparent fixed inset div when menu is open to catch clicks.

const hitokoto = ref({ hitokoto: "加载中...", from: "" });
const fetchHitokoto = async () => {
  try {
    const res = await fetch("https://v1.hitokoto.cn/?c=i&c=d&c=k");
    hitokoto.value = await res.json();
  } catch {
    hitokoto.value = { hitokoto: "生活原本沉闷，但跑起来就有风。", from: "网络" };
  }
};

// --- IP 组件 ---
let ipInterval: number | null = null;
const ipInfo = ref({
  wanIp: "",
  lanIp: "",
  location: "",
  clientIp: "",
  clientIpSource: "",
  baiduLatency: "--",
});

const hasWanIp = computed(() => {
  const v = String(ipInfo.value.wanIp || "").trim();
  return !!v && v !== "Error" && v !== "获取失败";
});

const hasLanIp = computed(() => {
  const v = String(ipInfo.value.lanIp || "").trim();
  return !!v;
});

const displayIp = computed(() => {
  if (hasWanIp.value) return ipInfo.value.wanIp;
  if (hasLanIp.value) return ipInfo.value.lanIp;
  return "加载中...";
});

const isIpv6 = computed(() => {
  const ip = String(displayIp.value || "");
  return ip.includes(":");
});

const ipTypeLabel = computed(() => {
  if (!hasWanIp.value && hasLanIp.value) return "内网 IP";
  return isIpv6.value ? "IPv6" : "外网 IP";
});

const showClientIp = computed(() => {
  if (!ipInfo.value.clientIp) return false;
  return ipInfo.value.clientIp !== ipInfo.value.wanIp;
});

const copiedToast = ref("");
let copiedToastTimer: number | null = null;
const copyToClipboard = async (text: string) => {
  const value = String(text || "").trim();
  if (!value) return;
  if (value === "加载中..." || value === "检测中..." || value === "Error")
    return;
  try {
    await navigator.clipboard.writeText(value);
    copiedToast.value = "已复制";
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = value;
      el.style.position = "fixed";
      el.style.left = "-9999px";
      el.style.top = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      copiedToast.value = "已复制";
    } catch {
      copiedToast.value = "复制失败";
    }
  }

  if (copiedToastTimer) window.clearTimeout(copiedToastTimer);
  copiedToastTimer = window.setTimeout(() => {
    copiedToast.value = "";
    copiedToastTimer = null;
  }, 1200);
};

const formattedLocation = computed(() => {
  const loc = ipInfo.value.location;
  if (!loc) return "";
  const parts = loc.split(" ").filter((p) => p.trim());
  if (parts.length === 0) return "";

  let isp = "";
  let area = "";

  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    const isIsp = /[a-zA-Z]/.test(lastPart) || /电信|联通|移动|铁通|网通|教育|科技|信息|网络|数据|通信|广播|电视|有线|公司/.test(lastPart);
    if (isIsp) {
      isp = lastPart;
      area = parts.slice(0, parts.length - 1).join(" ");
    } else {
      area = parts.join(" ");
    }
  } else {
    area = parts[0];
  }

  area = area.replace(/^.+?省/, "");
  area = area.replace(/^.+?市(?=.+)/, "");

  if (isp) {
    isp = isp.replace(/ADSL|宽带|光纤/gi, "");
  }

  const shortArea = area.trim();
  if (shortArea) {
    const chineseMatch = shortArea.match(/[\u4e00-\u9fa5]+[市区县]/);
    if (chineseMatch) {
      return chineseMatch[0];
    }
    const englishMatch = shortArea.match(/([A-Z][a-z]+(?:\s+[a-z]+)*?)(?:\s+(?:network|province|state|region|node|china))/i);
    if (englishMatch) {
      return englishMatch[1].trim();
    }
  }

  return shortArea || loc;
});

const fetchIp = async (force = false) => {
  const CACHE_KEY = `flatnas_ip_cache:${networkScope}`;
  const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in ms
  const initialIsLanMode = isLanMode.value;
  store.ipFetchStatus = "loading";
  store.isLanModeInited = false;

  if (!force) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { timestamp, data } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          ipInfo.value = data;
          lastKnownClientIp.value = data?.clientIp || "";
          lastKnownClientIpSource.value = data?.clientIpSource || "";
          const cfg = networkConfig.value;
          const result = computeEffectiveNetworkMode(
            window.location.hostname,
            lastKnownClientIp.value,
            lastKnownClientIpSource.value,
            latency.value,
            {
              internalDomains: cfg.internalDomains,
              networkRules: cfg.networkRules,
              forceNetworkMode: cfg.forceNetworkMode,
              latencyThresholdMs: cfg.latencyThresholdMs,
            },
          );
          isLanMode.value = result.isLan;
          store.ipFetchStatus = "success";
          store.isLanModeInited = true;
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to read IP cache", e);
    }
  }

  ipInfo.value = {
    wanIp: "",
    lanIp: "",
    location: "",
    clientIp: "",
    clientIpSource: "",
    baiduLatency: "...",
  };

  // 检测 223.5.5.5 延迟 (通过后端 /api/ping)
  fetch("/api/ping?target=223.5.5.5")
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        ipInfo.value.baiduLatency = data.latency;
      } else {
        ipInfo.value.baiduLatency = "Timeout";
      }
      updateCache();
    })
    .catch(() => {
      ipInfo.value.baiduLatency = "Error";
      updateCache();
    });

  try {
    const refreshParam = force ? "&refresh=1" : "";
    const res = await fetchWithTimeout(
      `/api/ip?ts=${Date.now()}${refreshParam}`,
      { method: "GET" },
      30000,
    );
    const data = await res.json();

    if (data.success) {
      ipInfo.value.wanIp = data.ip || "";
      ipInfo.value.lanIp = data.clientIp || "";
      ipInfo.value.location = data.location || "未知位置";
      ipInfo.value.clientIp = data.clientIp || "";
      ipInfo.value.clientIpSource = data.clientIpSource || "";
      lastKnownClientIp.value = ipInfo.value.clientIp;
      lastKnownClientIpSource.value = ipInfo.value.clientIpSource;

      const cfg = networkConfig.value;
      const result = computeEffectiveNetworkMode(
        window.location.hostname,
        lastKnownClientIp.value,
        lastKnownClientIpSource.value,
        latency.value,
        {
          internalDomains: cfg.internalDomains,
          networkRules: cfg.networkRules,
          forceNetworkMode: cfg.forceNetworkMode,
          latencyThresholdMs: cfg.latencyThresholdMs,
        },
      );
      isLanMode.value = result.isLan;
      store.ipFetchStatus = "success";
    } else {
      ipInfo.value.wanIp = data.ip || "";
      ipInfo.value.lanIp = data.clientIp || "";
      ipInfo.value.location = "未知位置";
      ipInfo.value.clientIp = data.clientIp || "";
      ipInfo.value.clientIpSource = data.clientIpSource || "";
      isLanMode.value = initialIsLanMode;
      store.ipFetchStatus = "error";
    }
    store.isLanModeInited = true;
    updateCache();
  } catch (e) {
    console.error("IP Fetch Error", e);
    ipInfo.value.wanIp = "";
    isLanMode.value = initialIsLanMode;
    store.ipFetchStatus = "error";
    store.isLanModeInited = true;
    updateCache();
  }
};

const updateCache = () => {
  if (ipInfo.value.baiduLatency !== "...") {
    localStorage.setItem(
      `flatnas_ip_cache:${networkScope}`,
      JSON.stringify({
        timestamp: Date.now(),
        data: ipInfo.value,
      }),
    );
  }
};

// --- IP 组件结束 ---

// Visitor Stats
const onlineDuration = ref("00:00:00");
const totalVisitors = ref(0);
const todayVisitors = ref(0);
let onlineTimer: ReturnType<typeof setInterval> | null = null;
let onlineStartTime = 0;
let onlineElapsedMs = 0;

const updateOnlineDuration = () => {
  const elapsed = onlineElapsedMs + (onlineStartTime ? Date.now() - onlineStartTime : 0);
  const diff = Math.floor(elapsed / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  onlineDuration.value = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

const startOnlineTimer = () => {
  if (onlineTimer) clearInterval(onlineTimer);
  onlineStartTime = Date.now();
  updateOnlineDuration();
  onlineTimer = setInterval(() => {
    updateOnlineDuration();
  }, 5000);
};

const stopOnlineTimer = () => {
  if (onlineStartTime) {
    onlineElapsedMs += Date.now() - onlineStartTime;
    onlineStartTime = 0;
  }
  if (onlineTimer) clearInterval(onlineTimer);
  onlineTimer = null;
};

const handleFooterVisibilityChange = () => {
  if (!store.appConfig.showFooterStats) return;
  if (document.visibilityState === "hidden") stopOnlineTimer();
  else startOnlineTimer();
};

const recordVisit = async () => {
  try {
    const res = await fetch("/api/visitor/track", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      totalVisitors.value = data.totalVisitors;
      todayVisitors.value = data.todayVisitors;
    }
  } catch (e) {
    console.error("Failed to record visit", e);
  }
};

watch(
  () => store.appConfig.showFooterStats,
  (val) => {
    if (val) {
      onlineElapsedMs = 0;
      startOnlineTimer();
      document.addEventListener("visibilitychange", handleFooterVisibilityChange);
      recordVisit();
    } else {
      stopOnlineTimer();
      document.removeEventListener("visibilitychange", handleFooterVisibilityChange);
    }
  },
  { immediate: true },
);

onMounted(() => {
  fetchHitokoto();
  updateHour();
  if (daylightTimer) clearInterval(daylightTimer);
  daylightTimer = setInterval(updateHour, 60 * 1000);
});

onUnmounted(() => {
  if (daylightTimer) clearInterval(daylightTimer);
  if (weatherTimer) clearInterval(weatherTimer);
  stopRain();
});
</script>

<template>
  <div class="flatnas-handshake-signal" style="display: none !important"></div>
  <div
    class="min-h-dvh relative overflow-hidden flex flex-col pt-[env(safe-area-inset-top)]"
    :class="{ 'empire-theme': store.appConfig.empireMode }"
  >
    <!-- Wallpaper Auto-Update Error Toast -->
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="opacity-0 -translate-y-4"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-4"
    >
      <div
        v-if="apiUpdateError"
        class="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-red-500/90 backdrop-blur-sm text-white px-4 py-2 rounded-xl shadow-lg flex items-center gap-3 text-sm font-medium max-w-[90vw]"
      >
        <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span class="truncate">{{ apiUpdateError }}</span>
        <button
          @click="resetError"
          class="shrink-0 ml-2 w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
        >
          ×
        </button>
      </div>
    </Transition>

    <!-- ✨ Global Background Layer -->
    <div class="fixed inset-0 z-0 pointer-events-none select-none">
      <!-- Default Background (Gradient Clouds) -->
      <div
        v-if="!store.appConfig.empireMode && store.appConfig.solidBackgroundColor"
        class="absolute inset-0 transition-all duration-500"
        :style="{ backgroundColor: store.appConfig.solidBackgroundColor }"
      ></div>
      <div
        v-else-if="!store.appConfig.empireMode"
        class="absolute inset-0 transition-all duration-500"
        style="background-image: linear-gradient(to top, #a18cd1 0%, #fbc2eb 100%)"
      ></div>

      <!-- Empire Mode Background -->
      <div
        v-if="store.appConfig.empireMode"
        class="absolute inset-0 z-20"
        style="background: radial-gradient(circle at 50% 50%, #2a2a2a, #000000)"
      >
        <div
          class="absolute inset-0 opacity-30"
          :style="{ backgroundImage: `url('${store.getAssetUrl(empireBackgroundUrl)}')` }"
        ></div>
      </div>

      <!-- Desktop Image Layer -->
      <div
        class="absolute inset-[-20px] bg-cover bg-center bg-no-repeat"
        :class="(store.appConfig.enableMobileWallpaper ?? true) ? 'hidden md:block' : 'block'"
        v-if="store.appConfig.background"
        :style="{
          backgroundImage: `url('${pcBgUrl}')`,
          filter: `blur(${store.appConfig.backgroundBlur ?? 0}px)`,
          opacity: isPcBgLoaded ? 1 : 0,
          transition: 'opacity 0.5s ease-in-out, filter 0.3s ease-in-out',
        }"
      ></div>

      <!-- Mobile Image Layer -->
      <div
        class="absolute inset-[-20px] bg-cover bg-center bg-no-repeat md:hidden"
        v-if="(store.appConfig.enableMobileWallpaper ?? true) && store.appConfig.mobileBackground"
        :style="{
          backgroundImage: `url('${store.getAssetUrl(store.appConfig.mobileBackground)}')`,
          filter: `blur(${store.appConfig.mobileBackgroundBlur ?? 0}px)`,
          opacity: isMobileBgLoaded ? 1 : 0,
          transition: 'opacity 0.5s ease-in-out, filter 0.3s ease-in-out',
        }"
      ></div>

      <!-- 纹理平移图层 -->
      <div
        v-if="showRainEffect"
        class="absolute inset-[-20px] bg-cover bg-center bg-no-repeat animate-texture-pan pointer-events-none"
        :style="{ backgroundImage: `url('${store.getAssetUrl('/rain-texture.png')}')`, opacity: 0.15 }"
      ></div>

      <!-- 深度雾层 -->
      <div
        v-if="showFogEffect"
        class="absolute inset-0 bg-gradient-to-b from-black/30 to-black/60 animate-fog-fade pointer-events-none"
      ></div>

      <canvas
        ref="rainCanvasRef"
        class="absolute inset-0 pointer-events-none transition-opacity"
        :class="showRainEffect ? 'opacity-70' : 'opacity-0'"
      ></canvas>

      <!-- Desktop Mask Layer -->
      <div
        class="absolute inset-0 transition-all duration-300"
        :class="(store.appConfig.enableMobileWallpaper ?? true) ? 'hidden md:block' : 'block'"
        :style="{
          backgroundColor: `rgba(0,0,0,${effectiveBackgroundMask})`,
        }"
      ></div>

      <!-- Mobile Mask Layer -->
      <div
        class="absolute inset-0 transition-all duration-300 md:hidden"
        v-if="store.appConfig.enableMobileWallpaper ?? true"
        :style="{
          backgroundColor: `rgba(0,0,0,${effectiveMobileBackgroundMask})`,
        }"
      ></div>
    </div>

    <AppSidebar
      v-if="isSidebarEnabled"
      v-model:collapsed="sidebarCollapsed"
      class="fixed left-0 top-0 z-40 pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)]"
      :class="isMobile && sidebarCollapsed ? 'h-auto' : 'h-full'"
      :onOpenSettings="openSettings"
      :onOpenEdit="openEditOrLogin"
    />

    <div
      class="flex-1 w-full p-4 md:p-8 transition-all pb-[calc(2rem+env(safe-area-inset-bottom))] md:pb-[calc(2.5rem+env(safe-area-inset-bottom))] relative z-10"
      ref="mainContainerRef"
      :style="{
        backgroundColor:
          store.appConfig.background || store.appConfig.solidBackgroundColor
            ? 'transparent'
            : '#f3f4f6',
        '--group-title-color': store.appConfig.groupTitleColor || '#ffffff',
        '--card-bg-color': store.appConfig.cardBgColor || 'transparent',
        '--card-border-color': store.appConfig.cardBorderColor || 'transparent',
        '--card-border-hover-color':
          store.appConfig.cardBorderColor && store.appConfig.cardBorderColor !== 'transparent'
            ? store.appConfig.cardBorderColor
            : store.appConfig.background || store.appConfig.solidBackgroundColor
              ? 'rgba(255, 255, 255, 0.35)'
              : 'rgba(15, 23, 42, 0.12)',
        paddingLeft:
          isSidebarEnabled && !isMobile ? (sidebarCollapsed ? '100px' : '288px') : undefined,
      }"
    >
      <div class="mx-auto transition-all duration-300" :style="{ maxWidth: mainContentMaxWidth }">
        <div
          class="flex flex-col xl:flex-row xl:justify-between items-center gap-6 relative flatnas-header-container"
          :class="isWebPaginationMode ? 'mb-4' : 'mb-4'"
        >
          <div
            class="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 flex-shrink-0 relative z-[60] transition-all duration-500"
            :style="{ order: isHeaderRowLayout && store.appConfig.titleAlign === 'right' ? 2 : 0 }"
          >
            <h1
              class="font-bold transition-all duration-300 whitespace-nowrap"
              :style="{
                fontSize: store.appConfig.titleSize + 'px',
                color: store.appConfig.titleColor,
                textShadow: store.appConfig.background ? '0 2px 8px rgba(0,0,0,0.5)' : 'none',
              }"
            >
              {{ store.appConfig.customTitle }}
            </h1>
            <div
              class="items-center bg-white/90 backdrop-blur border border-gray-200 shadow-sm rounded-full p-1 gap-1 h-8"
              :class="store.appConfig.hideHeaderOnMobile ? 'hidden xl:flex' : 'flex'"
            >
              <button
                @click="openSettings"
                class="xl:hidden w-6 h-6 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center transition-all"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  class="w-4 h-4"
                >
                  <path
                    fill-rule="evenodd"
                    d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567l-.091.549a.798.798 0 01-.517.608 7.45 7.45 0 00-.478.198.798.798 0 01-.796-.064l-.453-.324a1.875 1.875 0 00-2.416.2l-.043.044a1.875 1.875 0 00-.204 2.416l.325.454a.798.798 0 01.064.796 7.448 7.448 0 00-.198.478.798.798 0 01-.608.517l-.55.092a1.875 1.875 0 00-1.566 1.849v.044c0 .917.663 1.699 1.567 1.85l.549.091c.281.047.508.25.608.517.06.162.127.321.198.478a.798.798 0 01-.064.796l-.324.453a1.875 1.875 0 00.2 2.416l.044.043a1.875 1.875 0 002.416.204l.454-.325a.798.798 0 01.796-.064c.157.071.316.137.478.198.267.1.47.327.517.608l.092.55c.15.903.932 1.566 1.849 1.566h.044c.917 0 1.699-.663 1.85-1.567l.091-.549a.798.798 0 01.517-.608 7.52 7.52 0 00.478-.198.798.798 0 01.796.064l.453.324a1.875 1.875 0 002.416-.2l.043-.044a1.875 1.875 0 00.204-2.416l-.325-.454a.798.798 0 01-.064-.796c.071-.157.137-.316.198-.478.1-.267.327-.47.608-.517l.55-.092a1.875 1.875 0 001.566-1.849v-.044c0-.917-.663-1.699-1.567-1.85l-.549-.091a.798.798 0 01-.608-.517 7.507 7.507 0 00-.198-.478.798.798 0 01.064-.796l.324-.453a1.875 1.875 0 00-.2-2.416l-.044-.043a1.875 1.875 0 00-2.416-.204l-.454.325a.798.798 0 01-.796.064 7.462 7.462 0 00-.478-.198.798.798 0 01-.517-.608l-.092-.55a1.875 1.875 0 00-1.849-1.566h-.044zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
                    clip-rule="evenodd"
                  />
                </svg>
              </button>
              <button
                v-if="store.isLogged"
                @click="toggleEditMode"
                class="xl:hidden px-3 h-6 rounded-full text-[10px] font-bold transition-all"
                :class="
                  isEditMode
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                "
              >
                {{ isEditMode ? "完成" : "编辑" }}
              </button>
              <button
                @click="toggleForceMode"
                class="px-3 h-6 rounded-full text-[10px] font-bold transition-all"
                :class="{
                  'bg-gray-100 text-gray-400 hover:bg-gray-200': forceMode === 'auto',
                  'bg-green-100 text-green-600 hover:bg-green-200': forceMode === 'lan',
                  'bg-blue-100 text-blue-600 hover:bg-blue-200': forceMode === 'wan',
                  'bg-yellow-100 text-yellow-700 hover:bg-yellow-200': forceMode === 'latency',
                }"
              >
                {{
                  forceMode === "auto"
                    ? "自动"
                    : forceMode === "lan"
                      ? "强制内网"
                      : forceMode === "wan"
                        ? "强制外网"
                        : "延迟判定"
                }}
              </button>
              <div
                class="flex items-center gap-2 px-3 h-full rounded-full text-[10px] font-medium cursor-pointer hover:bg-gray-100 transition-all select-none"
                @click="handleNetworkClick"
              >
                <template v-if="isChecking"
                  ><div
                    class="w-2 h-2 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"
                  ></div
                ></template>
                <template v-else
                  ><div
                    class="w-1.5 h-1.5 rounded-full"
                    :class="effectiveIsLan ? 'bg-green-500' : 'bg-blue-500'"
                  ></div>
                  <span :class="effectiveIsLan ? 'text-green-700' : 'text-blue-700'">{{
                    effectiveIsLan ? "内网" : "外网"
                  }}</span
                  ><span class="text-gray-400 border-l pl-2 ml-1">{{ latency }}ms</span></template
                >
              </div>
              <button
                @click="handleAuthAction"
                class="px-3 h-6 rounded-full text-[10px] font-bold transition-all"
                :class="[
                  store.isLogged
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-gray-100 text-gray-500 hover:bg-blue-500 hover:text-white',
                ]"
              >
                {{ store.isLogged ? "退出" : "登录" }}
              </button>
            </div>
          </div>

          <div
            v-if="checkVisible(store.widgets.find((w) => w.id === 'w5'))"
            class="w-full xl:absolute xl:left-1/2 xl:-translate-x-1/2 z-50 transition-all duration-300"
            ref="searchAreaRef"
            :class="isWideLayout ? 'xl:w-[27rem]' : 'xl:w-60'"
          >
            <!-- ① 胶囊搜索框：左=当前引擎图标，右=放大镜提交 -->
            <form
              class="mx-auto shadow-lg hover:shadow-xl transition-shadow rounded-full bg-white/90 backdrop-blur-md border border-white/40 flex items-center p-1.5 flatnas-search-form"
              :style="{
                width: '100%',
                height: '46px',
                backgroundColor: `rgba(255, 255, 255, ${searchBgAlpha})`,
                '--flatnas-search-text-color': searchTextColor,
                '--flatnas-search-placeholder-color': searchPlaceholderColor,
              }"
              @submit.prevent="doSearch"
              action="."
            >
              <button
                type="button"
                class="w-9 h-9 ml-0.5 mr-2 flex items-center justify-center rounded-full bg-white border border-gray-100 shadow-sm flex-shrink-0 hover:shadow transition-shadow"
                :title="currentEngine ? `搜索引擎：${currentEngine.label}（点击切换）` : '搜索'"
                aria-label="切换搜索引擎"
                @click.stop="showSearchPanel = !showSearchPanel"
                @mousedown.stop
              >
                <img
                  v-if="currentEngine && engineFavicon(currentEngine) && !failedFavicons.has(currentEngine.key)"
                  :src="engineFavicon(currentEngine)"
                  class="w-5 h-5"
                  alt=""
                  @error="currentEngine && failedFavicons.add(currentEngine.key)"
                />
                <span
                  v-else-if="currentEngine && engineSvgMap[currentEngine.key]"
                  class="w-5 h-5 block"
                  v-html="engineSvgMap[currentEngine.key]"
                />
                <span v-else class="text-sm font-bold text-gray-500">
                  {{ currentEngine?.label?.charAt(0) || "搜" }}
                </span>
              </button>
              <input
                ref="searchInputRef"
                id="main-search-input"
                name="q"
                v-model="searchText"
                @keyup.enter="doSearch"
                @mousedown.stop
                type="search"
                role="searchbox"
                aria-label="搜索框"
                autocomplete="off"
                autofocus
                class="h-full flex-1 min-w-0 pl-1 pr-3 bg-transparent border-0 outline-none flatnas-search-input text-[15px]"
                placeholder="请输入搜索内容"
              />
              <button
                type="submit"
                class="w-9 h-9 mr-0.5 flex items-center justify-center rounded-full flex-shrink-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                aria-label="搜索"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                  stroke="currentColor"
                  class="w-5 h-5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                  />
                </svg>
              </button>
            </form>

            <!-- ② 弹层：引擎快捷切换 + 新窗口开关
                 默认隐藏，点搜索框左侧的引擎图标（showSearchPanel）才显示；
                 绝对定位挂在搜索框正下方（不占文档流，不会把搜索栏顶动），左对齐搜索栏；
                 点弹层外由 onClickOutside 收起。 -->
            <div
              v-show="showSearchPanel"
              class="absolute top-full left-0 mt-2 z-50 w-fit max-w-full rounded-2xl bg-white/90 backdrop-blur-md border border-white/40 shadow-lg px-3 py-2.5"
              @mousedown.stop
            >
              <div class="flex items-center gap-2">
                <button
                  v-for="e in engines"
                  :key="e.key"
                  type="button"
                  class="w-9 h-9 rounded-xl bg-white border border-gray-100 shadow-md flex items-center justify-center transition-all hover:scale-105 hover:shadow-lg flex-shrink-0"
                  :class="effectiveEngine === e.key ? 'ring-2 ring-blue-400 opacity-100' : 'opacity-90'"
                  :title="e.label"
                  :aria-label="`切换到 ${e.label}`"
                  @click.stop="effectiveEngine = e.key"
                >
                  <span
                    v-if="engineSvgMap[e.key]"
                    class="w-5 h-5 block"
                    v-html="engineSvgMap[e.key]"
                  />
                  <img
                    v-else-if="engineFavicon(e) && !failedFavicons.has(e.key)"
                    :src="engineFavicon(e)"
                    class="w-5 h-5"
                    alt=""
                    @error="failedFavicons.add(e.key)"
                  />
                  <span v-else class="text-sm font-bold text-gray-500">{{ e.label.charAt(0) }}</span>
                </button>
                <button
                  type="button"
                  class="w-9 h-9 rounded-xl bg-white border border-gray-100 shadow-md flex items-center justify-center transition-all hover:scale-105 hover:shadow-lg flex-shrink-0 text-gray-500 hover:text-gray-700"
                  title="搜索引擎设置"
                  aria-label="搜索引擎设置"
                  @click.stop="openSettings"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    class="w-5 h-5"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567l-.091.549a.798.798 0 01-.517.608 7.45 7.45 0 00-.478.198.798.798 0 01-.796-.064l-.453-.324a1.875 1.875 0 00-2.416.2l-.043.044a1.875 1.875 0 00-.204 2.416l.325.454a.798.798 0 01.064.796 7.448 7.448 0 00-.198.478.798.798 0 01-.608.517l-.55.092a1.875 1.875 0 00-1.566 1.849v.044c0 .917.663 1.699 1.567 1.85l.549.091c.281.047.508.25.608.517.06.162.127.321.198.478a.798.798 0 01-.064.796l-.324.453a1.875 1.875 0 00.2 2.416l.044.043a1.875 1.875 0 002.416.204l.454-.325a.798.798 0 01.796-.064c.157.071.316.137.478.198.267.1.47.327.517.608l.092.55c.15.903.932 1.566 1.849 1.566h.044c.917 0 1.699-.663 1.85-1.567l.091-.549a.798.798 0 01.517-.608 7.52 7.52 0 00.478-.198.798.798 0 01.796.064l.453.324a1.875 1.875 0 002.416-.2l.043-.044a1.875 1.875 0 00.204-2.416l-.325-.454a.798.798 0 01-.064-.796c.071-.157.137-.316.198-.478.1-.267.327-.47.608-.517l.55-.092a1.875 1.875 0 001.566-1.849v-.044c0-.917-.663-1.699-1.567-1.85l-.549-.091a.798.798 0 01-.608-.517 7.507 7.507 0 00-.198-.478.798.798 0 01.064-.796l.324-.453a1.875 1.875 0 00-.2-2.416l-.044-.043a1.875 1.875 0 00-2.416-.204l-.454.325a.798.798 0 01-.796.064 7.462 7.462 0 00-.478-.198.798.798 0 01-.517-.608l-.092-.55a1.875 1.875 0 00-1.849-1.566h-.044zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </button>
              </div>

              <!-- 新窗口打开开关（在弹层内，白底上用深色文字） -->
              <label
                class="flex items-center gap-1.5 mt-2 mx-auto w-fit text-xs font-medium text-gray-700 cursor-pointer select-none"
                title="关闭后将在当前窗口打开搜索结果"
                @mousedown.stop
              >
                <input
                  type="checkbox"
                  v-model="searchOpenInNewTab"
                  class="w-4 h-4 accent-green-600 cursor-pointer flex-shrink-0"
                />
                搜索结果使用新窗口打开
              </label>
            </div>
          </div>

          <div
            class="flex gap-1 xl:gap-3 flex-shrink-0 z-10 items-center transition-all duration-500 flatnas-handshake-signal absolute left-0 top-0 w-full xl:w-auto xl:static opacity-80 hover:opacity-100 xl:opacity-100 pointer-events-none xl:pointer-events-auto"
            :style="{ order: isHeaderRowLayout && store.appConfig.titleAlign === 'right' ? 0 : 2 }"
          >
            <MiniPlayer
              v-if="checkVisible(store.widgets.find((w) => w.type === 'player'))"
              key="mini-player-static"
              class="mr-auto xl:mr-0 pointer-events-auto"
            />
            <button
              @click="openSettings"
              class="hidden xl:flex pointer-events-auto rounded-full text-white items-center justify-center backdrop-blur transition-all w-8 h-8 xl:w-10 xl:h-10 bg-transparent xl:bg-white/20 xl:hover:bg-white/40 border-0 xl:border xl:border-white/20 shadow-none xl:shadow-sm"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="w-6 h-6"
              >
                <path
                  fill-rule="evenodd"
                  d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567l-.091.549a.798.798 0 01-.517.608 7.45 7.45 0 00-.478.198.798.798 0 01-.796-.064l-.453-.324a1.875 1.875 0 00-2.416.2l-.043.044a1.875 1.875 0 00-.204 2.416l.325.454a.798.798 0 01.064.796 7.448 7.448 0 00-.198.478.798.798 0 01-.608.517l-.55.092a1.875 1.875 0 00-1.566 1.849v.044c0 .917.663 1.699 1.567 1.85l.549.091c.281.047.508.25.608.517.06.162.127.321.198.478a.798.798 0 01-.064.796l-.324.453a1.875 1.875 0 00.2 2.416l.044.043a1.875 1.875 0 002.416.204l.454-.325a.798.798 0 01.796-.064c.157.071.316.137.478.198.267.1.47.327.517.608l.092.55c.15.903.932 1.566 1.849 1.566h.044c.917 0 1.699-.663 1.85-1.567l.091-.549a.798.798 0 01.517-.608 7.52 7.52 0 00.478-.198.798.798 0 01.796.064l.453.324a1.875 1.875 0 002.416-.2l.043-.044a1.875 1.875 0 00.204-2.416l-.325-.454a.798.798 0 01-.064-.796c.071-.157.137-.316.198-.478.1-.267.327-.47.608-.517l.55-.092a1.875 1.875 0 001.566-1.849v-.044c0-.917-.663-1.699-1.567-1.85l-.549-.091a.798.798 0 01-.608-.517 7.507 7.507 0 00-.198-.478.798.798 0 01.064-.796l.324-.453a1.875 1.875 0 00-.2-2.416l-.044-.043a1.875 1.875 0 00-2.416-.204l-.454.325a.798.798 0 01-.796.064 7.462 7.462 0 00-.478-.198.798.798 0 01-.517-.608l-.092-.55a1.875 1.875 0 00-1.849-1.566h-.044zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>
            <button
              v-if="store.isLogged"
              @click="toggleEditMode"
              class="hidden xl:block pointer-events-auto rounded-lg text-sm font-medium transition-all"
              :class="
                isEditMode
                  ? 'bg-red-500 text-white px-4 py-2 shadow-sm'
                  : 'bg-transparent text-white/70 hover:text-white xl:bg-white xl:text-gray-700 xl:hover:bg-gray-50 px-2 py-1 xl:px-4 xl:py-2 xl:shadow-sm shadow-none'
              "
            >
              {{ isEditMode ? "完成" : "编辑" }}
            </button>
            <button
              v-if="store.isLogged && isEditMode"
              @click="store.saveData(true)"
              :disabled="store.isSaving"
              class="hidden xl:flex pointer-events-auto rounded-lg text-sm font-medium transition-all items-center gap-1.5 px-4 py-2"
              :class="
                store.hasUnsavedChanges
                  ? 'bg-amber-500 text-white shadow-sm hover:bg-amber-600'
                  : 'bg-white/20 text-white/70 hover:bg-white/30'
              "
              title="保存配置到服务端"
            >
              <span v-if="store.isSaving" class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {{ store.isSaving ? "保存中…" : "保存" }}
            </button>
            <button
              v-if="store.isLogged && isEditMode"
              @click="addDivCardWidget"
              class="hidden xl:flex pointer-events-auto rounded-lg text-sm font-medium transition-all bg-blue-500 text-white px-4 py-2 shadow-sm hover:bg-blue-600"
            >
              新建卡片
            </button>
          </div>
        </div>

        <VueDraggable
          v-if="isWebPaginationMode"
          v-model="store.groups"
          class="mb-3 flex items-center gap-2 overflow-x-auto scrollbar-hide py-1"
          :group="{ name: 'pagination-groups', pull: false, put: false }"
          :sort="isEditMode && !searchText"
          :disabled="!isEditMode || !!searchText"
          @end="() => store.markDirty()"
        >
          <button
            v-for="group in displayGroups"
            :key="group.id"
            type="button"
            @click="activePaginationGroupId = group.id"
            class="shrink-0 h-9 px-3.5 rounded-xl text-sm font-medium backdrop-blur-md transition-colors border shadow-sm bg-white/10 text-white/75 hover:bg-white/15 hover:text-white/90 active:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-black/30"
            :class="
              activePaginationGroupId === group.id
                ? 'bg-white/22 border-white/35 text-white shadow-[0_6px_18px_rgba(0,0,0,0.18)] ring-1 ring-white/35'
                : 'border-white/12'
            "
          >
            {{ group.title }}
          </button>
        </VueDraggable>

        <div
          v-if="layoutData.length > 0"
          class="group-container transition-all"
          :style="{ marginBottom: (store.appConfig.groupGap ?? 30) + 'px' }"
        >
          <GridLayout
            v-if="isGridAlive"
            v-model:layout="scaledLayoutData"
            :col-num="widgetColNum * gridScale"
            :row-height="scaledRowHeight"
            :is-draggable="isEditMode && !activeResizeWidgetId"
            :is-resizable="false"
            :vertical-compact="true"
            :use-css-transforms="true"
            :margin="gridMargin"
            @layout-updated="handleScaledLayoutUpdated"
            :class="[
              'text-white select-none transition-all duration-300',
              activeResizeWidgetId ? 'smooth-size' : '',
            ]"
          >
          <GridItem
            v-for="widget in layoutData"
            :key="widget.i"
            :x="scaleGridValue(widget.x)"
            :y="scaleGridValue(widget.y)"
            :w="scaleGridValue(widget.w)"
            :h="scaleGridValue(widget.h)"
            :i="widget.i"
            :drag-allow-from="isHandheld && isEditMode ? '.widget-drag-handle' : undefined"
            :drag-ignore-from="
              isEditMode
                ? isHandheld
                  ? 'a'
                  : undefined
                : undefined
            "
            class="transition-all duration-300 relative"
            :class="[
              isEditMode
                ? 'ring-2 ring-blue-400/50 rounded-2xl cursor-move hover:ring-blue-500'
                : '',
              widget.hideOnMobile ? 'hidden md:block' : '',
              activeResizeWidgetId === widget.id ? '!z-[1000]' : '',
              store.appConfig.empireMode && isEmpireCloudWidget(widget.type)
                ? 'empire-cloud-widget'
                : '',
            ]"
          >
            <button
              v-if="isEditMode && widget.type === 'div-card'"
              @click.stop="deleteDivCardWidget(widget.id)"
              class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg z-50 hover:bg-red-600 hover:scale-110 transition-all"
            >
              ✕
            </button>
            <button
              v-if="isEditMode"
              @click.stop="onWidgetHandleClick(widget)"
              @pointerdown="onWidgetHandlePointerDown"
              @pointermove="onWidgetHandlePointerMove"
              @pointerup="onWidgetHandlePointerUp"
              @pointercancel="onWidgetHandlePointerUp"
              class="widget-drag-handle absolute bottom-2 right-2 w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center shadow-lg z-50 hover:bg-blue-600 hover:scale-110 transition-all touch-none"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                ></path>
              </svg>
            </button>

            <SizeSelector
              v-if="isEditMode && activeResizeWidgetId === widget.id"
              :current-col="widget.w || widget.colSpan || 1"
              :current-row="widget.h || widget.rowSpan || (widget.type === 'bookmarks' ? 2 : 1)"
              @select="(size: { colSpan: number; rowSpan: number }) => handleSizeSelect(widget, size)"
            />
            <ClockWidget v-if="widget.type === 'clock'" :widget="widget" />
            <SimpleWeatherWidget v-else-if="widget.type === 'weather'" :widget="widget" />
            <CalendarWidget v-else-if="widget.type === 'calendar'" :widget="widget" />
            <MemoWidget v-else-if="widget.type === 'memo'" :widget="widget" />
            <TodoWidget v-else-if="widget.type === 'todo'" :widget="widget" />
            <MusicWidget v-else-if="widget.type === 'music'" :widget="widget" />
            <CalculatorWidget v-else-if="widget.type === 'calculator'" />
            <div
              v-else-if="widget.type === 'div-card'"
              @click.stop="handleDivCardClick(widget)"
              @mousedown.right.prevent.stop="handleDivCardContextMenuPointerDown($event, widget)"
              @contextmenu.prevent.stop="handleDivCardContextMenu($event, widget)"
              class="div-card-click-target w-full h-full p-3 rounded-2xl border text-white flex flex-col justify-center items-center text-center relative overflow-hidden group transition-all duration-300"
              :class="[
                widget.data?.backgroundImage
                  ? 'border-white/20 bg-white/10 backdrop-blur'
                  : 'border-transparent bg-transparent',
                store.appConfig.mouseHoverEffect === 'lift'
                  ? 'hover:-translate-y-1 hover:shadow-lg'
                  : store.appConfig.mouseHoverEffect === 'glow'
                    ? 'hover:shadow-[0_0_15px_rgba(168,85,247,0.5)]'
                    : ''
              ]"
            >
              <!-- ✨ 背景图层 (高斯模糊 + 遮罩) -->
              <div
                v-if="widget.data?.backgroundImage"
                class="absolute inset-0 z-0 pointer-events-none overflow-hidden rounded-[inherit]"
              >
                <div
                  class="absolute inset-0 bg-cover bg-center transition-all duration-300"
                  :style="{
                    backgroundImage: `url('${store.getAssetUrl(widget.data.backgroundImage)}')`,
                    filter: `blur(${widget.data.backgroundBlur ?? 6}px)`,
                    transform: 'scale(1.1)',
                  }"
                ></div>
                <div
                  class="absolute inset-0"
                  :style="{
                    backgroundColor: `rgba(0,0,0,${widget.data.backgroundMask ?? 0.3})`,
                  }"
                ></div>
              </div>

              <!-- Icon -->
              <div
                v-if="widget.data?.icon"
                class="relative flex items-center justify-center flex-shrink-0 transition-all duration-300 z-10 mb-2"
                :style="{
                  width: ((store.appConfig.iconSize || 48) * ((widget.data.iconSize || 100) / 100)) + 'px',
                  height: ((store.appConfig.iconSize || 48) * ((widget.data.iconSize || 100) / 100)) + 'px',
                }"
              >
                <IconShape
                  :shape="store.appConfig.iconShape || 'circle'"
                  :size="((store.appConfig.iconSize || 48) * ((widget.data.iconSize || 100) / 100))"
                  :imgScale="100"
                  :bgClass="
                    widget.data.color &&
                    !widget.data.color.includes('sky') &&
                    widget.data.color !== '#000000' &&
                    widget.data.color !== 'bg-black'
                      ? widget.data.color
                      : 'bg-white'
                  "
                  :icon="processIcon(widget.data.icon)"
                  class="w-full h-full"
                  :class="widget.data.backgroundImage ? 'drop-shadow-lg' : ''"
                />
              </div>

              <div
                class="text-sm font-semibold tracking-wide relative z-10 truncate w-full px-2"
                :style="{
                  color: widget.data?.titleColor || '#ffffff',
                  textShadow: widget.data?.backgroundImage ? '0 2px 4px rgba(0,0,0,0.8)' : 'none',
                }"
              >
                {{ widget.data?.title || "div 卡片" }}
              </div>

              <div
                v-if="!widget.data?.url && !widget.data?.lanUrl && !widget.data?.icon"
                class="text-[10px] opacity-70 mt-1 relative z-10"
              >
                请在编辑模式下右键添加项目
              </div>
            </div>
            <div
              v-else-if="widget.type === 'ip'"
              class="w-full h-full p-3 rounded-2xl backdrop-blur border border-white/10 flex flex-col items-center transition-colors text-center text-white"
              :style="{
                backgroundColor: `rgba(0,0,0,${Math.min(0.85, Math.max(0.15, widget.opacity ?? 0.35))})`,
                color: '#fff',
              }"
            >
              <div
                v-if="ipInfo.location && ipInfo.location !== '未知位置'"
                class="text-[19px] font-medium sm:font-bold w-full truncate flex-1 flex items-center justify-center -mt-px"
                :title="ipInfo.location"
              >
                {{ formattedLocation }}
              </div>
              <div v-if="hasWanIp" class="flex items-center justify-center gap-2 w-full flex-1">
                <span class="text-[12px] opacity-70 uppercase">外网</span>
                <button
                  class="max-w-full font-mono font-medium sm:font-bold leading-tight text-center select-text break-all hover:opacity-90 transition-opacity text-xl"
                  type="button"
                  title="点击复制外网 IP"
                  @click.stop="copyToClipboard(ipInfo.wanIp)"
                >
                  {{ ipInfo.wanIp }}
                </button>
              </div>
              <div v-if="hasLanIp" class="flex items-center justify-center gap-2 w-full flex-1">
                <span class="text-[10px] opacity-50 uppercase">内网</span>
                <button
                  class="max-w-full font-mono font-medium leading-tight text-center select-text break-all opacity-70 hover:opacity-90 transition-opacity text-sm"
                  type="button"
                  title="点击复制内网 IP"
                  @click.stop="copyToClipboard(ipInfo.lanIp)"
                >
                  {{ ipInfo.lanIp }}
                </button>
              </div>
              <div v-if="!hasWanIp && !hasLanIp" class="flex items-center justify-center gap-2 w-full flex-1">
                <span class="text-2xl font-mono opacity-60">{{ displayIp }}</span>
              </div>

              <div class="flex items-center justify-center gap-2 w-full flex-1">
                <span class="text-[12px] opacity-70 uppercase">PING测试</span>
                <div
                  class="text-base font-mono font-medium text-white/90 bg-white/20 backdrop-blur-sm border border-white/20 px-2 py-0.5 rounded"
                >
                  {{ ipInfo.baiduLatency }}
                </div>
                <button
                  @click="fetchIp(true)"
                  class="text-[12px] text-white/80 bg-white/20 px-2.5 py-0.5 rounded hover:bg-white/30 transition-colors"
                >
                  刷新
                </button>
              </div>

              <div v-if="copiedToast" class="text-[11px] opacity-80 -mt-1">
                {{ copiedToast }}
              </div>
            </div>
            <CountdownWidget v-else-if="widget.type === 'countdown'" :widget="widget" />
            <CountUpWidget v-else-if="widget.type === 'countup'" :widget="widget" />
            <IframeWidget
              v-else-if="widget.type === 'iframe'"
              :widget="widget"
              :is-lan-mode="effectiveIsLan"
              :is-edit-mode="isEditMode"
            />
            <BookmarkWidget v-else-if="widget.type === 'bookmarks'" :widget="widget" />
            <HotWidget v-else-if="widget.type === 'hot'" :widget="widget" :is-edit-mode="isEditMode" />
            <ClockWeatherWidget v-else-if="widget.type === 'clockweather'" :widget="widget" />
            <AmapWeatherWidget v-else-if="widget.type === 'amap-weather'" :widget="widget" />
            <RssWidget v-else-if="widget.type === 'rss'" :widget="widget" />
            <DockerWidget v-else-if="widget.type === 'docker'" :widget="widget" />
            <CustomCssWidget v-else-if="widget.type === 'custom-css'" :widget="widget" />
            <FileTransferWidget v-else-if="widget.type === 'file-transfer'" :widget="widget" />
          </GridItem>
        </GridLayout>
        </div>

        <Transition name="fade">
          <div v-if="store.isLogged && isEditMode" class="flex justify-center mb-4 gap-4">
            <button
              data-testid="add-group-btn"
              @click="store.addGroup"
              class="bg-white/10 hover:bg-white/20 text-white backdrop-blur border border-white/20 px-6 py-2 rounded-full font-bold transition-all flex items-center gap-2 shadow-lg"
            >
              <span>➕</span> 新建分组
            </button>
          </div>
        </Transition>

        <VueDraggable
          :model-value="store.groups"
          handle=".group-handle"
          :move="checkMove"
          :animation="300"
          :forceFallback="true"
          :disabled="!isEditMode || isWebPaginationMode"
          @end="onGroupDragEnd"
          class="pb-20 flex flex-col transition-all"
          :style="{ gap: (store.appConfig.groupGap ?? 30) + 'px' }"
        >
          <div
            v-for="group in displayGroups"
            :key="group.id"
            class="group-container"
            :id="'group-' + group.id"
            v-show="!isWebPaginationMode || group.id === activePaginationGroupId"
          >
            <div
              class="flex items-center gap-3 mb-2 group-header relative transition-opacity duration-200"
              :class="{ 'opacity-0 hover:opacity-100': group.autoHideTitle }"
            >
              <div
                v-if="isEditMode"
                class="group-handle cursor-move text-white/50 hover:text-white p-1 select-none text-xl"
              >
                ⋮⋮
              </div>
              <h2
                class="text-xl font-bold shadow-text px-2 rounded transition-colors outline-none"
                :style="{
                  color:
                    group.titleColor ||
                    store.appConfig.groupTitleColor ||
                    'var(--group-title-color)',
                }"
              >
                {{ group.title }}
              </h2>

              <div class="flex items-center gap-2">
                <button
                  v-if="store.isLogged"
                  @click="openAddModal(group.id)"
                  class="w-7 h-7 rounded-full bg-white/10 hover:bg-white/30 text-white flex items-center justify-center transition-all shadow-sm border border-white/10"
                  title="添加卡片"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </button>

                <button
                  v-if="store.isLogged"
                  @click.stop="toggleGroupSettings(group.id)"
                  class="w-7 h-7 rounded-full bg-white/10 hover:bg-white/30 text-white flex items-center justify-center transition-all shadow-sm border border-white/10"
                  title="分组设置"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </button>

                <button
                  v-if="store.isLogged && isEditMode"
                  @click="openGroupDeleteConfirm(group.id)"
                  class="w-7 h-7 rounded-full bg-white/10 hover:bg-red-500 hover:text-white text-white/50 flex items-center justify-center transition-all shadow-sm border border-white/10"
                  title="删除分组"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-3.5 w-3.5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </button>
              </div>

              <span
                v-if="group.preset"
                class="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded border border-yellow-200"
              >
                预设
              </span>
            </div>

            <VueDraggable
              :model-value="group.items"
              @update:model-value="(newItems: NavItem[]) => onGroupItemsChange(group.id, newItems)"
              @end="() => store.markDirty()"
              group="apps"
              :animation="200"
              :forceFallback="true"
              :disabled="!isEditMode || !!searchText"
              class="grid transition-all duration-300 min-h-[100px] rounded-xl"
              :class="
                isEditMode ? 'bg-white/5 border-2 border-dashed border-white/20 p-2 md:p-4' : ''
              "
              :style="{
                gap: getLayoutConfig(group).gap + 'px',
                // 暴露给下方样式块 §7 用：电脑端要在此基础上 ×2，手机端保持原值
                '--grid-gap': getLayoutConfig(group).gap + 'px',
                gridTemplateColumns: `repeat(auto-fill, minmax(${getLayoutConfig(group).minWidth}px, 1fr))`,
              }"
              ghostClass="ghost"
            >
              <div
                v-for="item in group.items"
                :key="item.id"
                @click="handleCardClick(item)"
                @mousedown.right.prevent.stop="handleContextMenuPointerDown($event, item, group.id)"
                @contextmenu.prevent.stop="handleContextMenu($event, item, group.id)"
                @pointerdown="(e) => onCardPointerDown(e, item, group.id)"
                @pointermove="onCardPointerMove"
                @pointerup="onCardPointerUp"
                @pointercancel="onCardPointerUp"
                @touchstart="(e) => onCardTouchStart(e, item, group.id)"
                @touchmove="onCardTouchMove"
                @touchend="onCardTouchEnd"
                @touchcancel="onCardTouchEnd"
                class="card-item flex items-center justify-center cursor-pointer transition-all select-none relative group hover:z-[999]"
                :class="[
                  item.containerId && isUpdating.has(item.containerId)
                    ? 'opacity-50 pointer-events-none !cursor-not-allowed animate-pulse ring-2 ring-yellow-400'
                    : '',
                  isEditMode ? 'animate-pulse cursor-move ring-2 ring-blue-400' : '',
                  isHorizontalGroup(group)
                    ? 'flex-row px-4 py-3 gap-3 justify-start'
                    : 'flex-col justify-center',
                  (group.iconShape || store.appConfig.iconShape) === 'circle'
                    ? 'rounded-2xl'
                    : (group.iconShape || store.appConfig.iconShape) === 'rounded'
                      ? 'rounded-2xl'
                      : (group.iconShape || store.appConfig.iconShape) === 'leaf'
                        ? 'rounded-tl-3xl rounded-br-3xl rounded-tr-md rounded-bl-md'
                        : 'rounded-lg',
                  (group.showCardBackground ?? store.appConfig.showCardBackground) === false
                    ? ''
                    : 'border backdrop-blur-sm',
                  store.appConfig.mouseHoverEffect === 'lift'
                    ? 'hover:-translate-y-1 hover:shadow-lg'
                    : store.appConfig.mouseHoverEffect === 'glow'
                      ? 'hover:shadow-[0_0_15px_rgba(168,85,247,0.5)]'
                      : store.appConfig.mouseHoverEffect === 'none'
                        ? ''
                        : 'hover:scale-105 active:scale-95',
                ]"
                :style="{
                  height: getLayoutConfig(group).height + 'px',
                  backgroundColor: cardBackgroundColor(group, item),
                  borderColor:
                    (group.showCardBackground ?? store.appConfig.showCardBackground) === false
                      ? 'transparent'
                      : 'var(--card-border-color)',
                }"
              >
                <!-- ✨ 背景图层 (高斯模糊 + 遮罩) -->
                <div
                  v-if="item.backgroundImage || group.backgroundImage"
                  class="absolute inset-0 z-0 pointer-events-none overflow-hidden rounded-[inherit]"
                >
                  <div
                    class="absolute inset-0 bg-cover bg-center transition-all duration-300"
                    :style="{
                      backgroundImage: `url('${store.getAssetUrl(item.backgroundImage || group.backgroundImage)}')`,
                      filter: `blur(${item.backgroundImage ? (item.backgroundBlur ?? 6) : (group.backgroundBlur ?? 6)}px)`,
                      transform: 'scale(1.1)',
                    }"
                  ></div>
                  <div
                    class="absolute inset-0"
                    :style="{
                      backgroundColor: `rgba(0,0,0,${item.backgroundImage ? (item.backgroundMask ?? 0.3) : (group.backgroundMask ?? 0.3)})`,
                    }"
                  ></div>
                </div>

                <!-- Docker Stats Background Bars -->
                <div
                  v-if="getContainerStatus(item)"
                  class="absolute inset-0 z-0 pointer-events-none overflow-hidden rounded-[inherit]"
                >
                  <!-- Update Dot (Top Left) -->
                  <div
                    v-if="
                      getContainerStatus(item)?.hasUpdate &&
                      (!item.containerId || !isUpdating.has(item.containerId))
                    "
                    class="absolute top-1.5 left-1.5 w-2.5 h-2.5 rounded-full bg-red-500 z-50 shadow-[0_0_4px_rgba(239,68,68,0.8)] border border-white/40 animate-pulse"
                    title="Container Image Update Available"
                  ></div>

                  <!-- Updating Indicator -->
                  <div
                    v-if="item.containerId && isUpdating.has(item.containerId)"
                    class="absolute inset-0 z-[60] flex items-center justify-center bg-black/10 backdrop-blur-[1px]"
                  >
                    <div
                      class="animate-spin w-8 h-8 border-4 border-yellow-400 border-t-transparent rounded-full"
                    ></div>
                  </div>

                </div>

                <div
                  v-if="isEditMode && item.isPublic"
                  class="absolute bottom-1 right-1 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded border border-green-200 z-20"
                >
                  公开
                </div>
                <div
                  v-else-if="isEditMode"
                  class="absolute bottom-1 right-1 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded border border-gray-200 z-20"
                >
                  不公开
                </div>

                <div
                  class="relative flex items-center justify-center flex-shrink-0 transition-all duration-300 relative z-10"
                  v-if="!item.sysStat && (group.iconShape || store.appConfig.iconShape) !== 'hidden'"
                  :style="{
                    width: getLayoutConfig(group).iconSize + 'px',
                    height: getLayoutConfig(group).iconSize + 'px',
                  }"
                >
                  <div
                    class="absolute inset-0 overflow-hidden flex items-center justify-center rounded-[inherit]"
                  >
                    <IconShape
                      :shape="group.iconShape || store.appConfig.iconShape"
                      :size="getLayoutConfig(group).iconSize"
                      :imgScale="item.iconSize"
                      :bgClass="
                        item.color &&
                        !item.color.includes('sky') &&
                        item.color !== '#000000' &&
                        item.color !== 'bg-black'
                          ? item.color
                          : 'bg-white'
                      "
                      :icon="processIcon(item.icon || '')"
                      class="transition-all duration-300 relative z-10 w-full h-full"
                      :class="item.backgroundImage || group.backgroundImage ? 'drop-shadow-lg' : ''"
                    />
                  </div>

                  <!-- Container Status Indicator -->
                  <div
                    v-if="getContainerStatus(item)"
                    class="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white z-20"
                    :class="
                      getContainerStatus(item)?.state === 'running' ? 'bg-green-500' : 'bg-gray-400'
                    "
                    :title="getContainerStatus(item)?.state"
                  ></div>

                  <!-- Backup Url Badges -->
                  <!-- 外网备用地址 (左上角, 蓝色) -->
                  <div
                    v-if="item.backupUrls && item.backupUrls.length > 0"
                    class="absolute -top-1 -left-4 z-20 flex flex-col gap-0.5 pointer-events-auto"
                  >
                    <div
                      v-for="(url, idx) in item.backupUrls"
                      :key="'wan-' + idx"
                      @click.stop="openBackupUrl(url)"
                      class="flex items-center justify-center rounded-full bg-blue-600 text-white font-sans font-bold cursor-pointer hover:scale-110 hover:bg-blue-500 transition-all shadow-sm border border-white/50"
                      :style="{
                        width: Math.max(16, getLayoutConfig(group).iconSize * 0.22) + 'px',
                        height: Math.max(16, getLayoutConfig(group).iconSize * 0.22) + 'px',
                        fontSize: Math.max(10, getLayoutConfig(group).iconSize * 0.14) + 'px',
                        lineHeight: 1,
                      }"
                      :title="
                        typeof url === 'string' ? '外网: ' + url : url.name || '外网: ' + url.url
                      "
                    >
                      {{ idx + 1 }}
                    </div>
                  </div>

                  <!-- 内网备用地址 (右上角, 绿色) -->
                  <div
                    v-if="item.backupLanUrls && item.backupLanUrls.length > 0"
                    class="absolute -top-1 -right-4 z-20 flex flex-col gap-0.5 pointer-events-auto"
                  >
                    <div
                      v-for="(url, idx) in item.backupLanUrls"
                      :key="'lan-' + idx"
                      @click.stop="openBackupUrl(url)"
                      class="flex items-center justify-center rounded-full bg-green-600 text-white font-sans font-bold cursor-pointer hover:scale-110 hover:bg-green-500 transition-all shadow-sm border border-white/50"
                      :style="{
                        width: Math.max(16, getLayoutConfig(group).iconSize * 0.22) + 'px',
                        height: Math.max(16, getLayoutConfig(group).iconSize * 0.22) + 'px',
                        fontSize: Math.max(10, getLayoutConfig(group).iconSize * 0.14) + 'px',
                        lineHeight: 1,
                      }"
                      :title="
                        typeof url === 'string' ? '内网: ' + url : url.name || '内网: ' + url.url
                      "
                    >
                      {{ idx + 1 }}
                    </div>
                  </div>
                </div>

                <!-- 系统状态卡片（宿主机状态组件生成的 CPU/内存/磁盘卡）
                     背景由外层卡片容器提供（与普通卡片同一套），内部只有图标 + 标题 + 数值。 -->
                <SystemStatCard
                  v-if="item.sysStat"
                  :item="item"
                  :icon-size="getLayoutConfig(group).iconSize"
                  :title-color="
                    item.titleColor ||
                    (item.backgroundImage || group.backgroundImage
                      ? '#ffffff'
                      : group.cardTitleColor || store.appConfig.cardTitleColor || '#111827')
                  "
                  class="w-full h-full relative z-10"
                />

                <!-- Horizontal Mode: 标题 + CPU/内存信息 + 单行描述（描述在状态行下方） -->
                <div
                  v-else-if="isHorizontalGroup(group)"
                  class="flex-1 flex flex-col h-full justify-center gap-0.5 overflow-hidden relative z-10"
                >
                  <!-- Line 1 (Top)：卡片标题 -->
                  <div
                    :class="[
                      item.description1 ? 'text-xs' : 'text-left',
                      'truncate font-medium leading-tight flex justify-between items-center',
                    ]"
                    :style="{
                      color:
                        item.titleColor ||
                        (item.backgroundImage || group.backgroundImage
                          ? '#ffffff'
                          : group.cardTitleColor || store.appConfig.cardTitleColor || '#111827'),
                      fontSize: group.cardTitleSize ? group.cardTitleSize + 'px' : undefined,
                      textShadow:
                        item.backgroundImage || group.backgroundImage
                          ? '0 1px 2px rgba(0,0,0,0.8)'
                          : 'none',
                    }"
                  >
                    <span class="truncate flex-1">{{ item.title }}</span>
                  </div>

                  <!-- Docker Stats Info：纯文字显示 CPU / 内存占用（参考 sun-panel 样式）
                       两个 span 分开写：电脑端同一行（沿用原样），手机端由样式块 §8 换成竖排两行，
                       避免窄卡片里 RAM 被省略号截断。 -->
                  <div
                    v-if="getContainerStatus(item)"
                    class="docker-stats-line text-[10px] mt-0.5 w-full opacity-90 leading-none font-mono truncate"
                    title="CPU / 内存占用"
                    :style="{
                      color:
                        item.titleColor ||
                        (item.backgroundImage || group.backgroundImage
                          ? '#ffffff'
                          : group.cardTitleColor || store.appConfig.cardTitleColor || '#374151'),
                      textShadow:
                        item.backgroundImage || group.backgroundImage
                          ? '0 1px 2px rgba(0,0,0,0.8)'
                          : 'none',
                    }"
                  >
                    <template v-if="getContainerStatus(item)?.stats">
                      <span class="docker-stats-cpu"
                        >CPU:{{
                          (getContainerStatus(item)?.stats?.cpuPercent ?? 0).toFixed(1)
                        }}%</span
                      >
                      <span class="docker-stats-ram"
                        >RAM:{{ formatBytes(getContainerStatus(item)?.stats?.memUsage || 0, 1) }}</span
                      >
                    </template>
                    <template v-else>
                      <span class="docker-stats-cpu">CPU:--</span>
                      <span class="docker-stats-ram">RAM:--</span>
                    </template>
                  </div>

                  <!-- Line 2 (Middle)：单行描述，显示在 CPU/内存信息下方
                       （旧数据 description2/description3 不再渲染，仅保留字段兼容）
                       手机端由样式块 §11 整体隐藏（那里 CPU/RAM 已竖排占两行）。 -->
                  <div
                    class="card-desc-line text-[10px] truncate leading-tight opacity-80"
                    :style="{
                      color:
                        item.backgroundImage || group.backgroundImage
                          ? '#e5e7eb'
                          : group.cardTitleColor || store.appConfig.cardTitleColor || '#4b5563',
                      textShadow:
                        item.backgroundImage || group.backgroundImage
                          ? '0 1px 2px rgba(0,0,0,0.8)'
                          : 'none',
                    }"
                  >
                    {{ item.description1 || "" }}
                  </div>
                </div>

                <!-- Vertical Mode: Standard Title -->
                <span
                  v-else
                  class="font-medium truncate relative z-10"
                  :class="'text-center px-2 w-full'"
                  :style="{
                    color:
                      item.titleColor ||
                      (item.backgroundImage || group.backgroundImage
                        ? '#ffffff'
                        : group.cardTitleColor || store.appConfig.cardTitleColor || '#111827'),
                    fontSize: group.cardTitleSize ? group.cardTitleSize + 'px' : undefined,
                    textShadow:
                      item.backgroundImage || group.backgroundImage
                        ? '0 2px 4px rgba(0,0,0,0.8)'
                        : 'none',
                  }"
                >
                  {{ item.title }}
                </span>
              </div>
            </VueDraggable>
          </div>
        </VueDraggable>
      </div>
    </div>

    <!-- Footer -->
    <footer
      class="w-full z-10 relative shrink-0 px-8 transition-all flex items-center pb-[env(safe-area-inset-bottom)]"
      :class="[
        !store.appConfig.footerHeight ? 'pt-6' : '',
        isMobile
          ? 'pb-[calc(6rem+env(safe-area-inset-bottom))]'
          : !store.appConfig.footerHeight
            ? 'pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
            : '',
      ]"
      :style="{
        height: store.appConfig.footerHeight ? store.appConfig.footerHeight + 'px' : 'auto',
        marginBottom: (store.appConfig.footerMarginBottom || 0) + 'px',
      }"
    >
      <div
        class="mx-auto flex justify-between items-center w-full"
        :class="{ 'flex-col gap-6': isMobile }"
        :style="{
          maxWidth: (store.appConfig.footerWidth || 1280) + 'px',
          fontSize: (store.appConfig.footerFontSize || 12) + 'px',
        }"
      >
        <!-- Left: Visitor Stats -->
        <div
          class="flex-1 flex items-center justify-start gap-4"
          :class="{ '!justify-center order-last': isMobile }"
        >
          <!-- Connection Status -->
          <div
            v-if="false"
            class="flex items-center gap-2 opacity-80 select-none"
            :title="store.isConnected ? '已连接到服务器' : '与服务器断开连接'"
          >
            <div
              class="w-2 h-2 rounded-full transition-colors duration-300"
              :class="
                store.isConnected
                  ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]'
                  : 'bg-red-500 animate-pulse'
              "
            ></div>
            <span
              class="text-xs font-mono font-bold"
              :class="store.appConfig.background ? 'text-white shadow-text' : 'text-gray-500'"
              >{{ store.isConnected ? "LIVE" : "OFFLINE" }}</span
            >
          </div>

          <div
            v-if="store.appConfig.showFooterStats"
            class="flex gap-4 opacity-60 select-none"
            :class="store.appConfig.background ? 'text-white shadow-text' : 'text-gray-500'"
          >
            <div class="flex flex-col gap-1">
              <span>访客记录</span>
              <span class="font-mono">{{ totalVisitors }}</span>
            </div>
            <div class="w-px bg-current opacity-30"></div>
            <div class="flex flex-col gap-1">
              <span>今日访客</span>
              <span class="font-mono">{{ todayVisitors }}</span>
            </div>
            <div class="w-px bg-current opacity-30"></div>
            <div class="flex flex-col gap-1">
              <span>在线时长</span>
              <span class="font-mono">{{ onlineDuration }}</span>
            </div>
          </div>
        </div>

        <!-- Center: Custom HTML -->
        <div class="flex-1 flex justify-center px-4">
          <div
            v-if="store.appConfig.footerHtml"
            v-html="sanitizedFooterHtml"
            class="text-center opacity-60"
            :class="store.appConfig.background ? 'text-white shadow-text' : 'text-gray-500'"
          ></div>
        </div>

        <!-- Right: Quote -->
        <div class="flex-1 flex justify-end" :class="{ '!justify-center order-first': isMobile }">
          <div
            v-if="checkVisible(store.widgets.find((w) => w.id === 'w7'))"
            class="text-right max-w-md cursor-pointer hover:opacity-80 transition-opacity select-none"
            :class="{ '!text-center': isMobile }"
            @click="fetchHitokoto"
            title="点击刷新"
          >
            <p
              class="font-serif italic mb-1 opacity-70"
              :class="store.appConfig.background ? 'text-white shadow-text' : 'text-gray-600'"
              style="font-size: 1.25em"
            >
              “ {{ hitokoto.hitokoto }} ”
            </p>
            <p
              class="opacity-70"
              :class="store.appConfig.background ? 'text-white/80 shadow-text' : 'text-gray-400'"
            >
              —— {{ hitokoto.from }}
            </p>
          </div>
        </div>
      </div>
    </footer>

    <!-- Group Settings Overlay -->
    <GroupSettingsModal
      v-if="showGroupSettingsModal"
      v-model:show="showGroupSettingsModal"
      :groupId="activeGroupId"
    />

    <EditModal
      v-if="showEditModal"
      v-model:show="showEditModal"
      :data="currentEditItem"
      :groupId="currentGroupId"
      :onSave="handleSave"
    />
    <SystemStatEditModal
      v-if="showSysStatEditModal && sysStatEditItem"
      :show="showSysStatEditModal"
      :item="sysStatEditItem"
      :create="!!sysStatCreateGroupId"
      @update:show="handleSysStatModalClose"
      @save="handleSysStatSave"
    />
    <SettingsModal v-if="showSettingsModal" v-model:show="showSettingsModal" />
    <LoginModal v-if="showLoginModal" v-model:show="showLoginModal" />

    <!-- Context Menu -->
    <OverlayMotion
      :show="showContextMenu"
      :z-index="50"
      variant="context-menu"
      panel-class="fixed bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[160px] overflow-hidden"
      :panel-style="{ top: contextMenuPosition.y + 'px', left: contextMenuPosition.x + 'px' }"
    >
    <div
      ref="contextMenuRef"
      data-grid-context-menu
      role="menu"
    >
      <div
        v-if="contextMenuItem?.lanUrl"
        @click="handleMenuLanOpen"
        class="px-4 py-2 hover:bg-green-50 text-green-700 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
        role="menuitem"
        :aria-label="'内网访问 ' + (contextMenuItem.title || '')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
        <span class="text-[14px] truncate">内网访问</span>
      </div>
      <!-- Backup LAN URLs -->
      <template v-if="contextMenuItem?.backupLanUrls && contextMenuItem.backupLanUrls.length > 0">
        <div
          v-for="(url, index) in contextMenuItem.backupLanUrls"
          :key="'backup-lan-' + index"
          @click="handleMenuOpen(url)"
          class="px-4 py-2 hover:bg-green-50 text-green-600 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
          role="menuitem"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
          <span class="text-[14px] truncate">{{ typeof url === "string" ? "备用内网 " + (index + 1) : url.name || "备用内网 " + (index + 1) }}</span>
        </div>
      </template>

      <div
        v-if="contextMenuItem?.url && !contextMenuItem?.sysStat"
        @click="handleMenuWanOpen"
        class="px-4 py-2 hover:bg-blue-50 text-blue-700 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
        role="menuitem"
        :aria-label="'外网访问 ' + (contextMenuItem.title || '')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
        <span class="text-[14px] truncate">外网访问</span>
      </div>
      <!-- Backup WAN URLs -->
      <template v-if="contextMenuItem?.backupUrls && contextMenuItem.backupUrls.length > 0">
        <div
          v-for="(url, index) in contextMenuItem.backupUrls"
          :key="'backup-wan-' + index"
          @click="handleMenuOpen(url)"
          class="px-4 py-2 hover:bg-blue-50 text-blue-600 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
          role="menuitem"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span class="text-[14px] truncate">{{ typeof url === "string" ? "备用外网 " + (index + 1) : url.name || "备用外网 " + (index + 1) }}</span>
        </div>
      </template>

      <!-- Docker Actions -->
      <template v-if="contextMenuItem?.containerId || contextMenuItem?.containerName">
        <div
          v-if="getContainerStatus(contextMenuItem)?.hasUpdate && !isItemUpdating(contextMenuItem)"
          @click="
            handleDockerAction(contextMenuItem, 'update');
            closeContextMenu();
          "
          class="px-4 py-2 hover:bg-yellow-50 text-yellow-600 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
          role="menuitem"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span class="text-[14px] truncate">升级镜像</span>
        </div>

        <div
          v-if="getContainerStatus(contextMenuItem)?.state === 'running'"
          @click="
            handleDockerAction(contextMenuItem, 'stop');
            closeContextMenu();
          "
          class="px-4 py-2 hover:bg-red-50 text-red-600 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
          role="menuitem"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
          </svg>
          <span class="text-[14px] truncate">停止容器</span>
        </div>
        <div
          v-else
          @click="
            handleDockerAction(contextMenuItem, 'start');
            closeContextMenu();
          "
          class="px-4 py-2 hover:bg-green-50 text-green-600 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
          role="menuitem"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="text-[14px] truncate">启动容器</span>
        </div>

        <div
          @click="
            handleDockerAction(contextMenuItem, 'restart');
            closeContextMenu();
          "
          class="px-4 py-2 hover:bg-blue-50 text-blue-600 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
          role="menuitem"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span class="text-[14px] truncate">重启容器</span>
        </div>
      </template>

      <div
        @click="handleMenuEdit"
        class="px-4 py-2 hover:bg-blue-50 text-gray-700 cursor-pointer flex items-center gap-3 text-sm transition-colors"
        role="menuitem"
        aria-label="编辑卡片"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        <span class="text-[14px] truncate">编辑卡片</span>
      </div>
      <div
        @click="handleMenuDelete"
        class="px-4 py-2 hover:bg-red-50 text-red-600 cursor-pointer flex items-center gap-3 text-sm transition-colors border-t border-gray-100"
        role="menuitem"
        aria-label="删除卡片"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        <span class="text-[14px] truncate">删除卡片</span>
      </div>
    </div>
    </OverlayMotion>

    <!-- Delete Confirm Modal -->
    <OverlayMotion
      :show="showDeleteConfirm"
      :z-index="60"
      close-on-overlay
      overlay-class="bg-black/50 backdrop-blur-sm p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]"
      panel-class="max-w-sm"
      @close="showDeleteConfirm = false"
    >
      <div class="bg-white rounded-xl shadow-2xl p-6 w-full border border-gray-100">
        <h3 class="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
          <span class="text-red-500 text-xl">⚠️</span> 删除确认
        </h3>
        <p class="text-gray-600 mb-6">
          确定要删除这个{{ deleteType === "group" ? "分组" : "卡片" }}吗？此操作无法撤销。
        </p>
        <div class="flex justify-end gap-3">
          <button
            @click="showDeleteConfirm = false"
            class="px-4 py-2 min-h-[44px] rounded-lg text-gray-600 hover:bg-gray-100 font-medium transition-colors"
          >
            取消
          </button>
          <button
            @click="confirmDelete"
            class="px-4 py-2 min-h-[44px] rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium shadow-sm transition-colors flex items-center gap-1"
          >
            <span>🗑️</span> 删除
          </button>
        </div>
      </div>
    </OverlayMotion>
  </div>
</template>

<style scoped>
.ghost {
  opacity: 0.4;
  background: rgba(255, 255, 255, 0.5);
  border: 2px dashed #9ca3af;
}
.shadow-text {
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
}
.flatnas-search-input {
  color: var(--flatnas-search-text-color, #111827);
}
.flatnas-search-input::placeholder {
  color: var(--flatnas-search-placeholder-color, rgba(107, 114, 128, 1));
}
.card-item {
  border-color: var(--card-border-color);
  transition:
    border-color 200ms ease,
    box-shadow 200ms ease,
    transform 200ms ease;
}
.card-item:hover {
  border-color: var(--card-border-hover-color);
}
[contenteditable]:focus {
  background-color: rgba(255, 255, 255, 0.2);
}
.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.weather-texture-layer {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='2'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='0.25'/%3E%3C/svg%3E");
  background-size: 240px 240px;
  mix-blend-mode: screen;
  animation: weather-texture-pan 18s linear infinite;
}

.weather-fog-layer {
  background-image:
    radial-gradient(circle at 20% 30%, rgba(200, 220, 255, 0.35), transparent 55%),
    radial-gradient(circle at 70% 60%, rgba(180, 210, 255, 0.4), transparent 60%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(120, 140, 170, 0.35));
  filter: blur(12px);
  animation: weather-fog-drift 22s ease-in-out infinite;
}

@keyframes weather-texture-pan {
  0% {
    background-position: 0 0;
  }
  100% {
    background-position: 240px 240px;
  }
}

@keyframes weather-fog-drift {
  0%,
  100% {
    transform: translate3d(0, 0, 0);
  }
  50% {
    transform: translate3d(-3%, 2%, 0);
  }
}

:deep(path[class*="fill-sky-100"]),
:deep(path[class*="fill-blue-100"]),
:deep(path[class*="fill-blue-50"]),
:deep(path[class*="fill-gray-100"]),
:deep(path[class*="fill-purple-100"]),
:deep(path[class*="fill-green-100"]),
:deep(path[class*="fill-red-100"]),
:deep(path[class*="fill-yellow-100"]),
:deep(path[class*="fill-orange-100"]) {
  fill: #ffffff !important;
}

.empire-theme {
  --group-title-color: #ffd700 !important;
  --card-title-color: #ffd700 !important;
  color: #ffd700 !important;
}

.empire-theme :deep(.text-gray-900),
.empire-theme :deep(.text-gray-800),
.empire-theme :deep(.text-gray-700),
.empire-theme :deep(.text-gray-600),
.empire-theme :deep(.text-gray-500),
.empire-theme :deep(.text-gray-400) {
  color: #ffd700 !important;
}

.empire-theme :deep(.bg-white) {
  backdrop-filter: blur(10px);
}

.empire-theme :deep(.bg-gray-50) {
  background-color: rgba(0, 0, 0, 0.2) !important;
}

.empire-theme :deep(svg) {
  color: #ffd700 !important;
  fill: currentColor;
}

.empire-theme :deep(.border-gray-200),
.empire-theme :deep(.border-gray-100) {
  border-color: rgba(255, 215, 0, 0.2) !important;
}

/* Force background override for ALL widget root elements */
.empire-theme .vgl-item > * {
  background-color: #000000 !important;
  background-image:
    url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4af37' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E"),
    radial-gradient(circle at 50% 50%, #2a2a2a, #000000) !important;
  border: 1px solid rgba(255, 215, 0, 0.6) !important;
  box-shadow:
    inset 0 0 20px rgba(0, 0, 0, 0.8),
    0 0 10px rgba(255, 215, 0, 0.2) !important;
}

/* Hide original backgrounds of inner elements */
.empire-theme .vgl-item > * > [class*="bg-"],
.empire-theme .vgl-item > * > [class*="bg-gradient-"],
.empire-theme :deep(.bg-white),
.empire-theme :deep(.bg-white\/80),
.empire-theme :deep(.bg-yellow-100\/90),
.empire-theme :deep(.bg-gradient-to-br) {
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
}

/* Ensure backdrop-blur doesn't make things white */
.empire-theme :deep(.backdrop-blur),
.empire-theme :deep(.backdrop-blur-md),
.empire-theme :deep(.backdrop-blur-sm) {
  backdrop-filter: none !important;
}

/* Specific fix for Calendar, Todo, Bookmarks which use specific classes */
.empire-theme .vgl-item :deep(.bg-white\/90),
.empire-theme .vgl-item :deep(.bg-white\/50),
.empire-theme .vgl-item :deep(.hover\:bg-white:hover) {
  background-color: transparent !important;
}

/* Fix for Memo Widget */
.empire-theme :deep(.bg-yellow-100\/90) {
  background-color: transparent !important;
  border-color: transparent !important;
}

/* Ensure text visibility on the dark background */
.empire-theme :deep(.text-gray-900),
.empire-theme :deep(.text-gray-800),
.empire-theme :deep(.text-gray-700),
.empire-theme :deep(.text-gray-600),
.empire-theme :deep(.text-gray-500),
.empire-theme :deep(.text-gray-400),
.empire-theme :deep(.text-gray-300) {
  color: #ffd700 !important;
}

/* Fix for Todo Widget input area */
.empire-theme :deep(.bg-gray-50),
.empire-theme :deep(.focus\:bg-white:focus),
.empire-theme :deep(input),
.empire-theme :deep(textarea) {
  background-color: rgba(255, 255, 255, 0.05) !important;
  color: #ffd700 !important;
  border-color: rgba(255, 215, 0, 0.3) !important;
}

/* Fix for buttons and active states */
.empire-theme :deep(.bg-blue-50),
.empire-theme :deep(.bg-blue-100),
.empire-theme :deep(.bg-red-50),
.empire-theme :deep(.bg-red-100),
.empire-theme :deep(.bg-orange-50),
.empire-theme :deep(.bg-green-100),
.empire-theme :deep(.hover\:bg-gray-100:hover),
.empire-theme :deep(.hover\:bg-gray-200:hover) {
  background-color: rgba(255, 215, 0, 0.1) !important;
  color: #ffd700 !important;
  border-color: rgba(255, 215, 0, 0.2) !important;
}

/* Fix for specific text colors (Blue/Red/Green usually used for links/status) */
.empire-theme :deep(.text-blue-600),
.empire-theme :deep(.text-blue-500),
.empire-theme :deep(.text-blue-400),
.empire-theme :deep(.text-red-600),
.empire-theme :deep(.text-red-500),
.empire-theme :deep(.text-green-600),
.empire-theme :deep(.text-orange-600) {
  color: #ffd700 !important;
  text-shadow: 0 0 5px rgba(255, 215, 0, 0.3);
}

/* Calendar Today Highlight */
.empire-theme :deep(.text-red-600.font-bold) {
  color: #ff4500 !important;
  text-shadow: 0 0 10px rgba(255, 69, 0, 0.5);
}

/* Docker Status Bars */
.empire-theme :deep(.bg-gray-200) {
  background-color: rgba(255, 255, 255, 0.1) !important;
}
/* Weather Animations */
.animate-texture-pan {
  animation: texturePan 15s linear infinite;
}
.animate-fog-fade {
  animation: fogFade 8s ease-in-out infinite alternate;
}
@keyframes texturePan {
  0% { background-position: 0 0; }
  100% { background-position: 100% 100%; }
}
@keyframes fogFade {
  0% { opacity: 0.3; }
  100% { opacity: 0.7; }
}
</style>

<style>
/* ==================== 程序卡片内置优化（源自用户参考的"分组卡片优化.css"） ==================== */

/* 1. 图标背景处理：去除 SVG 图标的底色填充，使图标更干净 */
.group-container .grid svg [class*="transition-all"],
.group-container .grid svg g > rect:first-child,
.group-container .grid svg g > path:first-child {
  fill: transparent !important;
  opacity: 0 !important;
  stroke: none !important;
}

/* 2. 横向卡片紧凑化：收窄左右内边距、缩小图标与文字间距、固定 64px 高度 */
.group-container .grid > div.flex-row {
  padding-left: 10px !important;
  padding-right: 10px !important;
  gap: 6px !important;
  height: 64px !important;
  padding-top: 4px !important;
  padding-bottom: 4px !important;
}

/* 清除卡片内部元素的旧位移（防止冲突） */
.group-container .grid > div.flex-row > div.flex-shrink-0,
.group-container .grid > div.flex-row > div.flex-1 > div:first-child,
.group-container .grid > div.flex-row > div.flex-1 > div:last-child {
  transform: none !important;
}

/* 3. 分组标题右侧的 +号 / 设置按钮：默认隐藏，悬停标题栏时显示 */
.group-header h2 + div {
  opacity: 0 !important;
  transition: opacity 0.3s ease !important;
  pointer-events: none !important;
}

.group-header:hover h2 + div {
  opacity: 1 !important;
  pointer-events: auto !important;
}

/* 4. 分组间与底部间距收紧 */
.group-container {
  padding-bottom: 0 !important;
  margin-bottom: 0 !important;
}

.pb-20.flex.flex-col {
  padding-bottom: 0 !important;
}

/* 5. 卡片（网格项）允许收缩到轨道宽度以内
   ★ 实测踩坑：网格轨道用 1fr 时等价于 minmax(auto, 1fr)，**轨道最小宽度 =
   卡片自身的最小内容宽度**。卡片里 CPU/RAM 那行是 font-mono 且不可断行，
   实测把最小内容宽度顶到约 178px；手机两列每列只有 174px（390px 屏 - 32px 内边距），
   于是每列被硬撑到 178px、两列总宽 366px，右侧那一列被挤出屏幕 8px。
   给网格项 min-width:0，轨道才能按容器宽度收窄，文字交给 truncate 省略。 */
.group-container .grid > div {
  min-width: 0 !important;
}
.group-container .grid > div.flex-row > div.flex-1 {
  min-width: 0 !important;
}

/* 6. 移动端适配：小屏两列布局 */
@media (max-width: 768px) {
  .group-container .grid {
    /* 必须是 minmax(0, 1fr)：下限写 0 才能真正等分铺满；
       写 1fr 会在内容较宽时把列顶出屏幕（表现为最右一列露出屏幕外）。 */
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 10px !important;
  }
}

/* 7. 电脑端：行列间距放大到设置值的 2 倍
   --grid-gap 由模板的行内样式写入（= 设置里的行列间距）。
   只在 >768px 生效，手机端不命中，仍用 §6 里的 10px。
   （试过 ×3，观感偏空旷，×2 刚好。） */
@media (min-width: 769px) {
  .group-container .grid {
    gap: calc(var(--grid-gap, 8px) * 2) !important;
  }
}

/* 8. 手机端：CPU / RAM 竖排两行
   窄卡片里 "CPU:x% RAM:y" 一行放不下，RAM 会被 truncate 截成 "RAM:22.1 M…"。
   改成竖排后两个 span 各占一行；桌面端不受影响，仍是同一行。 */
@media (max-width: 768px) {
  .group-container .grid .docker-stats-line {
    display: flex !important;
    flex-direction: column !important;
    /* 覆盖 truncate 的 nowrap：竖排下要让每行自然显示 */
    white-space: normal !important;
    overflow: visible !important;
    line-height: 1.3 !important;
  }
}

/* 9. 电脑端：CPU / RAM 字号加大 + 两者之间留间距
   模板里两个 span 之间的换行空白被 Vue 的 whitespace:condense 吃掉了，
   电脑端同行时 "CPU:x%RAM:y" 会粘在一起；手机端是竖排，间距交给行高，
   所以只对 >768px 生效。用 margin 而不是 flex gap，保住 truncate 的省略号行为。 */
@media (min-width: 769px) {
  .group-container .grid .docker-stats-line {
    font-size: 12px;
    line-height: 1.2;
  }
  .group-container .grid .docker-stats-cpu {
    margin-right: 6px;
  }
}

/* 10. 系统状态卡片（CPU/内存/磁盘）：与普通横向卡片同高（64px）。
   §2 靠 .flex-row 类命中，若分组布局数据异常导致类名缺失，
   系统状态卡会掉回竖版高度（128px 基准），这里用 :has 兜底。 */
.group-container .grid > div:has(> .sys-stat-card) {
  height: 64px !important;
  flex-direction: row !important;
  align-items: center !important;
  padding-left: 10px !important;
  padding-right: 10px !important;
  gap: 6px !important;
}

/* 11. 手机端：隐藏横向卡片的描述行
   §8 已把 CPU / RAM 拆成竖排两行，卡片里只剩标题 + 状态两行；
   再塞一行描述会让 64px 卡片过于拥挤，故窄屏整体不显示描述。 */
@media (max-width: 768px) {
  .group-container .grid .card-desc-line {
    display: none !important;
  }
}
</style>
