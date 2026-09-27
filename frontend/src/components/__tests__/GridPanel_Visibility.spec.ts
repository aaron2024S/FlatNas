// @vitest-environment jsdom
/**
 * 「设为不公开的卡片，未登录时不该看得见」—— 组件级回归。
 *
 * 卡片区是 `v-for="widget in layoutData"`，而 layoutData 是由一个 watch 一次性算出来的，
 * checkVisible（未登录只放行 isPublic）只在那一次里跑。所以只要"登录态变化没有触发重算"，
 * 未登录访客的页面上就会继续留着 isPublic=false 的卡片 —— 现实中最容易撞上的路径是
 * 保存时拿到 401（stores/save.ts 会清 token，但不刷新页面、也不重新拉数据）。
 *
 * 这里直接盯住那条不变式：登录态一变，卡片区的可见集合立刻跟着变。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';
import GridPanel from '../GridPanel.vue';
import { createTestingPinia } from '@pinia/testing';
import { useAuthStore } from '@/stores/auth';

vi.mock('vue-draggable-plus', () => ({
  VueDraggable: {
    template: '<div><slot /></div>',
    props: ['modelValue', 'group', 'disabled', 'sort', 'handle', 'move', 'animation', 'forceFallback', 'ghostClass'],
  },
}));

vi.mock('grid-layout-plus', () => ({
  GridLayout: {
    template: '<div><slot /></div>',
    props: ['layout', 'col-num', 'row-height', 'is-draggable', 'is-resizable', 'vertical-compact', 'use-css-transforms', 'margin'],
  },
  GridItem: {
    template: '<div class="grid-item"><slot /></div>',
    props: ['x', 'y', 'w', 'h', 'i', 'drag-allow-from', 'drag-ignore-from'],
  },
}));

vi.mock('../composables/useWallpaperRotation', () => ({ useWallpaperRotation: () => {} }));
vi.mock('../composables/useDevice', () => ({
  useDevice: () => ({ deviceKey: { value: 'desktop' }, isMobile: { value: false } }),
}));
vi.mock('../utils/gridLayout', () => ({
  generateLayout: (widgets: Record<string, unknown>[]) =>
    widgets.map((w: Record<string, unknown>) => ({ ...w, i: w.id, x: 0, y: 0, w: 1, h: 1 })),
  compactVertical: (layout: unknown[]) => layout,
}));
vi.mock('@/utils/network', () => ({
  isInternalNetwork: () => false,
  getNetworkConfig: () => ({}),
  computeEffectiveNetworkMode: () => ({ isLan: false, reason: 'mocked', measuredLatencyMs: 0 }),
}));

const SECRET_CALCULATOR = {
  id: 'calculator',
  type: 'calculator',
  enable: true,
  isPublic: false, // ← 用户设成了「不公开」
  colSpan: 1,
  rowSpan: 1,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
};

const PUBLIC_MEMO = {
  id: 'memo',
  type: 'memo',
  enable: true,
  isPublic: true,
  colSpan: 1,
  rowSpan: 1,
  x: 0,
  y: 1,
  w: 1,
  h: 1,
};

const mountPanel = (token: string) => {
  const wrapper = mount(GridPanel, {
    global: {
      plugins: [
        createTestingPinia({
          createSpy: () => vi.fn().mockResolvedValue(undefined),
          initialState: {
            // main store 的 widgets / isLogged 都是子 store 派生的 computed，
            // 必须设到真正的子 store 上
            auth: { token },
            widgets: { widgets: [PUBLIC_MEMO, SECRET_CALCULATOR] },
          },
        }),
      ],
      stubs: {
        ClockWidget: true,
        SimpleWeatherWidget: true,
        CalendarWidget: true,
        MemoWidget: true,
        TodoWidget: true,
        MusicWidget: true,
        CalculatorWidget: true,
        CountdownWidget: true,
        CountUpWidget: true,
        IframeWidget: true,
        BookmarkWidget: true,
        HotWidget: true,
        ClockWeatherWidget: true,
        AmapWeatherWidget: true,
        RssWidget: true,
        DockerWidget: true,
        CustomCssWidget: true,
        FileTransferWidget: true,
        IconShape: true,
        MiniPlayer: true,
        AppSidebar: true,
        EditModal: true,
        SettingsModal: true,
        GroupSettingsModal: true,
        LoginModal: true,
        SizeSelector: true,
        transition: false,
      },
    },
  });
  return wrapper;
};

/** 等布局重算落定（watch → 计算 → 再渲染） */
const settle = async (wrapper: VueWrapper) => {
  await nextTick();
  await nextTick();
  await nextTick();
  return wrapper;
};

const hasCalculator = (wrapper: VueWrapper) => wrapper.find('calculator-widget-stub').exists();
const hasMemo = (wrapper: VueWrapper) => wrapper.find('memo-widget-stub').exists();

describe('GridPanel 卡片可见性', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未登录时不渲染 isPublic=false 的卡片，只渲染公开的那张', async () => {
    const wrapper = await settle(mountPanel(''));
    expect(hasMemo(wrapper)).toBe(true);
    expect(hasCalculator(wrapper)).toBe(false);
  });

  it('已登录时两张都渲染', async () => {
    const wrapper = await settle(mountPanel('test-token'));
    expect(hasMemo(wrapper)).toBe(true);
    expect(hasCalculator(wrapper)).toBe(true);
  });

  it('token 被清空（例如保存撞 401）后不刷新页面，不公开的卡片也要立刻消失', async () => {
    const wrapper = await settle(mountPanel('test-token'));
    expect(hasCalculator(wrapper)).toBe(true);

    // save.ts 的 401 分支就是这个动作：清 token、清 username，不重新拉数据、不刷新
    const auth = useAuthStore();
    auth.token = '';
    auth.username = '';
    await settle(wrapper);

    // 修复前这里是 true —— 布局缓存着"已登录时"的结果，未登录了计算器还在
    expect(hasCalculator(wrapper)).toBe(false);
    expect(hasMemo(wrapper)).toBe(true);
  });

  it('反向同样成立：重新登录后不刷新页面也能立刻看到不公开的卡片', async () => {
    const wrapper = await settle(mountPanel(''));
    expect(hasCalculator(wrapper)).toBe(false);

    const auth = useAuthStore();
    auth.token = 'test-token';
    await settle(wrapper);

    expect(hasCalculator(wrapper)).toBe(true);
  });
});
