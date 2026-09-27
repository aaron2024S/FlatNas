// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
          // OverlayMotion 内部是 <Teleport to="body">，会把菜单送出组件树，
          // wrapper.find 就搜不到 [data-grid-context-menu] 了。
          // stub 成普通 div，保留 show 语义与插槽内容。
          OverlayMotion: {
            props: ['show', 'zIndex', 'variant', 'panelClass', 'panelStyle'],
            template: '<div v-if="show" class="overlay-motion-stub"><slot /></div>'
          },
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
});
