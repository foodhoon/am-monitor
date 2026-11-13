/**
 * Cloudflare Workers + KV Backend for Multi-Channel Sales Monitoring
 * 环境变量配置 (wrangler.toml / Dashboard):
 * - SALES_KV: KV Namespace Binding
 * - ADMIN_USER: 管理员账号 (默认 admin_demo)
 * - ADMIN_PASS: 管理员密码
 */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: JSON_HEADERS });
    }

    const url = new URL(request.url);
    const isKvBound = Boolean(env.SALES_KV);

    // 1. 初始化看板数据接口
    if (url.pathname === "/api/bootstrap" && request.method === "GET") {
      if (!isKvBound) {
        return jsonResponse({ isKvBound: false, message: "KV not bound, fallback to client demo mode." }, 503);
      }

      const rawState = await env.SALES_KV.get("dashboard_state", { type: "json" });
      return jsonResponse({
        isKvBound: true,
        ...(rawState || { activeId: "camp_01", campaigns: {}, logs: [] })
      });
    }

    // 2. 管理员 / 访客登录与单设备互踢 Token 签发
    if (url.pathname === "/api/login" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const adminUser = env.ADMIN_USER || "admin_demo";
      const adminPass = env.ADMIN_PASS || "change_me_in_prod";

      if (body.username === adminUser && body.password === adminPass) {
        const sessionToken = crypto.randomUUID();
        if (isKvBound) {
          await env.SALES_KV.put("active_admin_session", sessionToken, { expirationTtl: 86400 });
        }
        return jsonResponse({ ok: true, role: "admin", token: sessionToken });
      }
      return jsonResponse({ ok: false, error: "INVALID_CREDENTIALS" }, 401);
    }

    // 3. 异常打标 / 参数更新与审计日志持久化
    if (url.pathname === "/api/state" && request.method === "POST") {
      if (!isKvBound) {
        return jsonResponse({ ok: false, error: "KV_NOT_BOUND" }, 503);
      }

      const authHeader = request.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "").trim();
      const activeToken = await env.SALES_KV.get("active_admin_session");

      if (!token || token !== activeToken) {
        return jsonResponse({ ok: false, error: "SESSION_REPLACED" }, 401);
      }

      const nextState = await request.json();
      await env.SALES_KV.put("dashboard_state", JSON.stringify(nextState));
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "NOT_FOUND" }, 404);
  },

  // 4. Cron Trigger 定时增量抓取任务骨架
  async scheduled(event, env, ctx) {
    if (!env.SALES_KV) return;
    // 在此处接入多渠道商品库存/销量接口并计算 Delta 写入 SALES_KV
    console.log(`[Cron ${new Date().toISOString()}] Polling multi-channel sales deltas...`);
  }
};