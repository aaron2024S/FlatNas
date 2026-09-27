import { describe, it, expect } from "vitest";
import { detectResponseRole, isExplicitGuest, shouldClearStaleToken } from "./responseRole";

describe("detectResponseRole", () => {
  it("服务端显式 isGuest:true 时判为访客", () => {
    expect(detectResponseRole({ isGuest: true, widgets: [] })).toBe("guest");
  });

  it("单用户模式的陷阱：访客响应被注入 username/version 也必须判为访客", () => {
    // backend/handlers/data.go 在 AuthMode=single 时给访客响应塞 username:"admin"，
    // 老启发式「有 username+version 就是已登录」在这里必然误判。
    const guestWithInjectedUsername = {
      isGuest: true,
      username: "admin",
      version: 12,
      systemConfig: { authMode: "single" },
      widgets: [],
    };
    expect(detectResponseRole(guestWithInjectedUsername)).toBe("guest");
  });

  it("服务端显式 isGuest:false 时判为已登录", () => {
    expect(detectResponseRole({ isGuest: false, widgets: [] })).toBe("auth");
  });

  it("没有 isGuest 字段时回退到老启发式：username + version ⇒ auth", () => {
    expect(detectResponseRole({ username: "admin", version: 3 })).toBe("auth");
  });

  it("没有 isGuest 字段时回退到老启发式：非空且全公开的 widgets ⇒ guest", () => {
    expect(detectResponseRole({ widgets: [{ isPublic: true }, { isPublic: true }] })).toBe("guest");
  });

  it("没有 isGuest 字段且 widgets 为空 ⇒ auth（空数组不足以断定是访客）", () => {
    expect(detectResponseRole({ widgets: [] })).toBe("auth");
  });

  it("空对象 / null / undefined 一律按 auth 处理（不主动降级）", () => {
    expect(detectResponseRole({})).toBe("auth");
    expect(detectResponseRole(null)).toBe("auth");
    expect(detectResponseRole(undefined)).toBe("auth");
  });
});

describe("isExplicitGuest", () => {
  it("只认字面量 true，其他一律 false", () => {
    expect(isExplicitGuest({ isGuest: true })).toBe(true);
    expect(isExplicitGuest({ isGuest: false })).toBe(false);
    expect(isExplicitGuest({ isGuest: "true" })).toBe(false);
    expect(isExplicitGuest({})).toBe(false);
    expect(isExplicitGuest(null)).toBe(false);
  });
});

describe("shouldClearStaleToken", () => {
  it("服务端明确回访客 + 本地自认已登录 ⇒ 清 token", () => {
    expect(shouldClearStaleToken({ isGuest: true }, true)).toBe(true);
  });

  it("服务端明确回访客但本地本来就没登录 ⇒ 不用清", () => {
    expect(shouldClearStaleToken({ isGuest: true }, false)).toBe(false);
  });

  it("已登录用户的正常响应（isGuest:false）⇒ 不清", () => {
    expect(shouldClearStaleToken({ isGuest: false, username: "admin", version: 7 }, true)).toBe(false);
  });

  it("老后端没有 isGuest 字段时，即使启发式判为 guest 也不许清 token", () => {
    // 关键边界：只会公开卡片的已登录用户，老启发式会误判成 guest。
    // 拿误判结果去清 token 等于把用户直接踢下线。
    const allPublicAuthResponse = { username: "admin", version: 9, widgets: [{ isPublic: true }] };
    expect(detectResponseRole(allPublicAuthResponse)).toBe("auth");
    expect(shouldClearStaleToken(allPublicAuthResponse, true)).toBe(false);
  });
});
