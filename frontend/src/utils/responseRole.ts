/**
 * 服务端 /api/data 响应的「身份」判定。
 *
 * 后端 GetData 只在**访客**响应（没带有效 token）里带 `isGuest: true`，
 * 已登录响应不带该字段 —— 前端据此就能确切知道这次响应是谁的视角。
 *
 * 为什么必须显式标志：单用户模式下访客响应也会被注入 `username: "admin"`
 * （backend/handlers/data.go），所以「响应里有没有 username + version」这套
 * 启发式根本区分不出角色，残留 token 时前端会一直自认已登录。
 */
export type ResponseRole = "auth" | "guest";

/** 服务端是否明确声明「这次响应是访客视角」。 */
export const isExplicitGuest = (data: Record<string, unknown> | null | undefined): boolean => {
  return !!data && data.isGuest === true;
};

/** 判断这次响应代表哪个身份。服务端显式标志优先，缺失时才回退到老启发式。 */
export const detectResponseRole = (
  data: Record<string, unknown> | null | undefined,
): ResponseRole => {
  if (!data) return "auth";
  if (data.isGuest === true) return "guest";
  if (data.isGuest === false) return "auth";

  // ---- 以下为兼容没有 isGuest 字段的老后端 ----
  if (data.username && data.version !== undefined) return "auth";
  if (Array.isArray(data.widgets)) {
    const widgets = data.widgets as Array<{ isPublic?: boolean }>;
    if (widgets.length > 0 && widgets.every((w) => w?.isPublic === true)) return "guest";
  }
  return "auth";
};

/**
 * 本地自认已登录、服务端却明确回了访客身份 ⇒ token 已失效（过期 / 被注销 / 数据被重置），
 * 必须清掉，否则前端会一直按已登录渲染，isPublic=false 的卡片继续对访客可见。
 *
 * 只认服务端的显式标志：拿启发式结果去清 token 会误伤
 * 「所有卡片恰好都是公开的已登录用户」。
 */
export const shouldClearStaleToken = (
  data: Record<string, unknown> | null | undefined,
  isLoggedIn: boolean,
): boolean => isExplicitGuest(data) && !!isLoggedIn;
