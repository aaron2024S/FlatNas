import { describe, it, expect } from 'vitest';
import { normalizeIncomingWidgets, createDefaultWidgetList } from './widgetUtils';
import type { WidgetConfig } from '@/types';

const secretCalculator: WidgetConfig = {
  id: 'calculator',
  type: 'calculator',
  enable: true,
  colSpan: 1,
  rowSpan: 1,
  isPublic: false, // 用户在设置里把它改成了「不公开」
};

describe('normalizeIncomingWidgets —— 访客不该凭空拿到一套默认组件', () => {
  it('访客拿到空数组时返回空列表，而不是补默认组件', () => {
    // 服务端 guest 过滤后可能一个公开组件都不剩（返回 [] 或 null）。
    // 旧实现会在这里补出整份默认表，其中 calculator 的 isPublic 是 true，
    // 于是"设为不公开"的计算器反而在未登录时冒出来。
    expect(normalizeIncomingWidgets([], false)).toEqual([]);
  });

  it('访客拿到 undefined / null 时同样返回空列表', () => {
    expect(normalizeIncomingWidgets(undefined, false)).toEqual([]);
    expect(normalizeIncomingWidgets(null as unknown as WidgetConfig[], false)).toEqual([]);
  });

  it('登录用户拿到空数组时仍然是完整默认列表（行为不变）', () => {
    const list = normalizeIncomingWidgets([], true);
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((w) => w.type === 'calculator')).toBe(true);
  });

  it('访客拿到的是非空列表时原样保留（是否可见由 checkVisible 决定，不在这里过滤）', () => {
    const list = normalizeIncomingWidgets([secretCalculator], false);
    expect(list.map((w) => w.id)).toContain('calculator');
    expect(list.find((w) => w.id === 'calculator')?.isPublic).toBe(false);
  });

  it('默认表里的计算器确实是 isPublic: true —— 这正是"不公开却看得见"的来源', () => {
    const fromDefault = createDefaultWidgetList(false).find((w) => w.type === 'calculator');
    expect(fromDefault?.isPublic).toBe(true);
  });
});
