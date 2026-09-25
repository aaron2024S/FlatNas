// 旧版本系统状态卡的默认颜色（深色主题遗留）。
// 这些值出现在旧数据 sysStat 里时应视为"未设置"，否则卡片会一直顶着
// 深底白字（2026-09-18 用户反馈：磁盘卡没跟随普通卡浅色背景）。
// 注意：新取色器恒输出 8 位 #RRGGBBAA，不会命中这些 6 位旧值，
// 因此用户在取色器里显式选同样的颜色不会被误洗。
const LEGACY_TEXT_COLORS = ["#fff", "#ffffff"];
const LEGACY_BG_COLORS = ["#2a2a2a6b"];
const LEGACY_PRIMARY_COLORS = ["#fff", "#ffffff"];
const LEGACY_SECONDARY_COLORS = ["#cfcdcfa8", "#cfcfca8"];

export const isLegacySysStatTextColor = (c?: string): boolean =>
  !!c && LEGACY_TEXT_COLORS.includes(c.trim().toLowerCase());

export const isLegacySysStatBgColor = (c?: string): boolean =>
  !!c && LEGACY_BG_COLORS.includes(c.trim().toLowerCase());

export const isLegacySysStatPrimaryColor = (c?: string): boolean =>
  !!c && LEGACY_PRIMARY_COLORS.includes(c.trim().toLowerCase());

export const isLegacySysStatSecondaryColor = (c?: string): boolean =>
  !!c && LEGACY_SECONDARY_COLORS.includes(c.trim().toLowerCase());
