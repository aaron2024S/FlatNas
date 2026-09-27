import { describe, it, expect } from "vitest";
import { classifyNetworkTarget, isInternalNetwork } from "./network";

describe("network rules: ip:", () => {
  it("matches ip prefix with trailing dot", () => {
    expect(classifyNetworkTarget("11.22.33.44", "ip:11.22.", "")).toBe("lan");
    expect(isInternalNetwork("11.22.33.44", "", "ip:11.22.")).toBe(true);
  });

  it("matches ip prefix without trailing dot", () => {
    expect(classifyNetworkTarget("11.22.33.44", "ip:11.22", "")).toBe("lan");
    expect(classifyNetworkTarget("11.22.33.44", "ip:11.22.33", "")).toBe("lan");
  });

  it("matches full ipv4 exactly (does not behave like prefix)", () => {
    expect(classifyNetworkTarget("11.22.33.44", "ip:11.22.33.44", "")).toBe("lan");
    expect(classifyNetworkTarget("11.22.33.45", "ip:11.22.33.44", "")).toBe("wan");
  });

  it("does not match domains", () => {
    expect(classifyNetworkTarget("example.com", "ip:11.22.", "")).toBe("wan");
  });
});

// IP 卡片的第二行靠 isInternalNetwork(clientIp) 决定标「内网」还是「外网」，
// 这几条把最容易被搞错的字面量钉住：公网 IPv6 绝不能算内网。
describe("IP 字面量的真实归属", () => {
  it("私网 IPv4 判为内网", () => {
    expect(isInternalNetwork("192.168.3.53")).toBe(true);
    expect(isInternalNetwork("10.0.0.7")).toBe(true);
    expect(isInternalNetwork("172.16.5.9")).toBe(true);
    expect(isInternalNetwork("172.31.255.254")).toBe(true);
    expect(isInternalNetwork("127.0.0.1")).toBe(true);
  });

  it("公网 IPv4（含 172.32 边界外）判为外网", () => {
    expect(isInternalNetwork("114.219.57.203")).toBe(false);
    expect(isInternalNetwork("172.32.0.1")).toBe(false);
    expect(isInternalNetwork("8.8.8.8")).toBe(false);
  });

  it("公网 IPv6（240e 段，用户实际遇到的）判为外网", () => {
    expect(isInternalNetwork("240e:3a5:483b:5e40:8d8a:3738:e702:f485")).toBe(false);
    expect(isInternalNetwork("2001:db8::1")).toBe(false);
  });

  it("链路本地 / ULA / 回环 IPv6 判为内网", () => {
    expect(isInternalNetwork("fe80::1")).toBe(true);
    expect(isInternalNetwork("fd00::1")).toBe(true);
    expect(isInternalNetwork("fc00::1")).toBe(true);
    expect(isInternalNetwork("::1")).toBe(true);
  });
});

