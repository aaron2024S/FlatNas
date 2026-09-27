// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';
import GridPanel from '../GridPanel.vue';
import { createTestingPinia } from '@pinia/testing';

// Mock dependencies
vi.mock('vue-draggable-plus', () => ({
  VueDraggable: {
    template: '<div><slot /></div>',
    props: ['modelValue', 'group', 'disabled', 'sort', 'handle', 'move', 'animation', 'forceFallback', 'ghostClass']
  }
}));

vi.mock('grid-layout-plus', () => ({
  GridLayout: {
    template: '<div><slot /></div>',
    props: ['layout', 'col-num', 'row-height', 'is-draggable', 'is-resizable', 'vertical-compact', 'use-css-transforms', 'margin']
  },
  GridItem: {
    template: '<div class="grid-item"><slot /></div>',
    props: ['x', 'y', 'w', 'h', 'i', 'drag-allow-from', 'drag-ignore-from']
  }
}));

// Mock composables
vi.mock('../composables/useWallpaperRotation', () => ({ useWallpaperRotation: () => { } }));
vi.mock('../composables/useDevice', () => ({
  useDevice: () => ({ deviceKey: { value: 'desktop' }, isMobile: { value: false } })
}));

// Mock utils
vi.mock('../utils/gridLayout', () => ({
  generateLayout: (widgets: Record<string, unknown>[]) => widgets.map((w: Record<string, unknown>) => ({ ...w, i: w.id, x: 0, y: 0, w: 1, h: 1 })),
  compactVertical: (layout: unknown[]) => layout
}));
vi.mock('@/utils/network', () => ({
  isInternalNetwork: () => false,
  getNetworkConfig: () => ({}),
  // GridPanel 还 import 了它；漏掉会在 mount 时抛
  // 「No "computeEffectiveNetworkMode" export is defined on the mock」
  computeEffectiveNetworkMode: () => ({
    isLan: false,
    reason: 'mocked',
    measuredLatencyMs: 0
  })
}));

/**
 * OverlayMotion 真实实现是 <Teleport to="body"> + Transition，会把菜单送出组件树，
 * wrapper.find 就搜不到了。这里保留它真正的 DOM 层次（外层容器 + 定位面板），
 * 只是不用 Teleport —— 这样测试才能断言「菜单最终落在了哪里」。
 */
const OverlayMotionStub = defineComponent({
  name: 'OverlayMotion',
  props: ['show', 'zIndex', 'variant', 'panelClass', 'panelStyle'],
  template: `
    <div v-if="show" class="overlay-motion-root">
      <div class="overlay-motion-panel" :style="panelStyle"><slot /></div>
    </div>
  `
});

// jsdom 里没有布局引擎：offsetWidth/offsetHeight 恒为 0，window 也没有真实尺寸。
// 想验证「菜单有没有翻到上面」，就得把这两个数显式给出来。
type Layout = {
  viewportWidth: number;
  viewportHeight: number;
  panelWidth: number;
  panelHeight: number;
};

const originalDescriptors: Record<string, PropertyDescriptor | undefined> = {};

const stubLayout = (layout: Layout) => {
  vi.stubGlobal('innerWidth', layout.viewportWidth);
  vi.stubGlobal('innerHeight', layout.viewportHeight);

  const read = (el: Element, axis: 'Width' | 'Height') =>
    el.classList?.contains('overlay-motion-panel')
      ? axis === 'Width'
        ? layout.panelWidth
        : layout.panelHeight
      : 0;

  (['offsetWidth', 'offsetHeight'] as const).forEach((key) => {
    originalDescriptors[key] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement) {
        return read(this, key === 'offsetWidth' ? 'Width' : 'Height');
      }
    });
  });

  // @vueuse 的 useWindowSize 只在 resize 时重读窗口尺寸，mount 之后再改要手动触发一次
  window.dispatchEvent(new Event('resize'));
};

const restoreLayout = () => {
  vi.unstubAllGlobals();
  (['offsetWidth', 'offsetHeight'] as const).forEach((key) => {
    const original = originalDescriptors[key];
    if (original) Object.defineProperty(HTMLElement.prototype, key, original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  });
};

const panelStyle = (wrapper: VueWrapper) =>
  wrapper.find('.overlay-motion-panel').attributes('style') || '';

/** 从内联样式里取出数值：style="top: 372px; left: 300px; ..." */
const styleValue = (style: string, prop: string) => {
  const matched = style.match(new RegExp(`${prop}:\\s*(-?[\\d.]+)px`));
  if (!matched) throw new Error(`样式里没有 ${prop}：${style}`);
  return Number(matched[1]);
};

describe('GridPanel Context Menu', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();

    wrapper = mount(GridPanel, {
      global: {
        plugins: [
          createTestingPinia({
            createSpy: () => vi.fn().mockResolvedValue(undefined),
            // 注意：main store 的 widgets / isLogged / groups 都是从子 store 派生的
            // computed getter，往 main 里塞 initialState 不会生效 —— 必须设到真正的
            // 子 store（widgets / auth）上，否则组件里一个 widget 都渲染不出来。
            initialState: {
              auth: { token: 'test-token' },
              widgets: {
                widgets: [
                  {
                    id: 'div-card-1',
                    type: 'div-card',
                    data: { title: 'Test Div Card' },
                    x: 0, y: 0, w: 1, h: 1, i: 'div-card-1',
                    enable: true,
                    isPublic: true
                  }
                ]
              }
            }
          })
        ],
        stubs: {
          OverlayMotion: OverlayMotionStub,
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
          transition: false
        }
      }
    });
    // store = useMainStore();
  });

  afterEach(() => {
    restoreLayout();
  });

  it('renders div-card widget correctly', () => {
    const divCard = wrapper.find('.div-card-click-target');
    expect(divCard.exists()).toBe(true);
    expect(divCard.text()).toContain('Test Div Card');
  });

  it('opens context menu on right click on div-card', async () => {
    const divCard = wrapper.find('.div-card-click-target');
    await divCard.trigger('contextmenu.prevent');

    const menu = wrapper.find('[data-grid-context-menu]');
    expect(menu.exists()).toBe(true);
    expect(menu.isVisible()).toBe(true);

    // Check menu items
    expect(menu.text()).toContain('编辑卡片');
    expect(menu.text()).toContain('删除卡片');

    // Check SVGs are present (w-4 h-4 class)
    const svgs = menu.findAll('svg.w-4.h-4');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('clicking delete calls confirm delete logic', async () => {
    const divCard = wrapper.find('.div-card-click-target');
    await divCard.trigger('contextmenu.prevent');

    const menu = wrapper.find('[data-grid-context-menu]');
    // Find delete button (last item usually)
    const items = menu.findAll('[role="menuitem"]');
    const deleteBtn = items[items.length - 1];

    if (!deleteBtn) throw new Error('Delete button not found');
    expect(deleteBtn.text()).toContain('删除卡片');
    await deleteBtn.trigger('click');

    // Check if delete confirm modal is shown
    expect(wrapper.text()).toContain('删除确认');
  });

  // —— 以下三例对应「卡片贴着屏幕下沿时菜单被切掉」这个问题 ——
  // 六项菜单实测约 160×216；原来的实现按 150×100 估算、且不做夹取，
  // 于是 600px 高的视口里点击 y=588 会把菜单放到 588，底边 588+216=804 直接出屏。
  describe('贴边定位', () => {
    const openAt = async (clientX: number, clientY: number) => {
      const divCard = wrapper.find('.div-card-click-target');
      await divCard.trigger('contextmenu', { clientX, clientY });
      // 位置是"渲染后实测尺寸 → 重算"两拍，等第二拍落定
      await nextTick();
      await nextTick();
    };

    it('下方放不下时翻到点击点上方，菜单完整落在视口内', async () => {
      const viewport = { viewportWidth: 1200, viewportHeight: 600 };
      const panel = { panelWidth: 160, panelHeight: 216 };
      stubLayout({ ...viewport, ...panel });

      await openAt(300, 588);

      const style = panelStyle(wrapper);
      const top = styleValue(style, 'top');
      const left = styleValue(style, 'left');

      // 向上翻：底边正好压在点击点上
      expect(top).toBe(588 - panel.panelHeight);
      expect(left).toBe(300);
      // 关键断言：整个菜单在视口内（含 8px 安全间距）
      expect(top).toBeGreaterThanOrEqual(8);
      expect(top + panel.panelHeight).toBeLessThanOrEqual(
        viewport.viewportHeight - 8
      );
      // 顺带说清原来的 bug：旧算法（top=588）会让菜单底部溢出视口 212px
      expect(588 + panel.panelHeight).toBeGreaterThan(viewport.viewportHeight - 8);
    });

    it('菜单比视口还高时夹进视口，并让菜单内部滚动', async () => {
      const viewport = { viewportWidth: 1200, viewportHeight: 300 };
      const panel = { panelWidth: 160, panelHeight: 600 };
      stubLayout({ ...viewport, ...panel });

      await openAt(200, 290);

      const style = panelStyle(wrapper);
      const top = styleValue(style, 'top');
      const maxHeight = styleValue(style, 'max-height');

      expect(top).toBe(8);
      expect(maxHeight).toBe(viewport.viewportHeight - 16);
      expect(style).toContain('overflow-y: auto');
      expect(top + maxHeight).toBeLessThanOrEqual(viewport.viewportHeight - 8);
    });

    it('靠右下角时同时向左上翻，且空间充足时仍是向下弹出', async () => {
      stubLayout({
        viewportWidth: 1200,
        viewportHeight: 600,
        panelWidth: 160,
        panelHeight: 216
      });

      // 空间充足：行为与改动前一致（贴着点击点往右下）
      await openAt(200, 120);
      let style = panelStyle(wrapper);
      expect(styleValue(style, 'top')).toBe(120);
      expect(styleValue(style, 'left')).toBe(200);

      // 右下角：两个方向都翻
      await openAt(1180, 588);
      style = panelStyle(wrapper);
      expect(styleValue(style, 'left')).toBe(1180 - 160);
      expect(styleValue(style, 'top')).toBe(588 - 216);
      expect(styleValue(style, 'left') + 160).toBeLessThanOrEqual(1200 - 8);
      expect(styleValue(style, 'top') + 216).toBeLessThanOrEqual(600 - 8);
    });
  });
});
