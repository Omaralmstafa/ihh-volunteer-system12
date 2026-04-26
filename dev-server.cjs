/**
 * خادم تطوير: ملفات ثابتة + /api/sheet?u=... ينقل الطلب لـ GAS (بدون CORS)
 *
 * التشغيل من جذر المشروع: node dev-server.cjs
 * ثم افتح: http://127.0.0.1:8080
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

function send(res, code, type, body) {
  if (type) res.setHeader("Content-Type", type);
  res.writeHead(code);
  res.end(body);
}

const ERR_GAS_AUTH =
  "نشر Web App يعيد 302 نحو تسجيل دخول Google. في Deploy → Manage deployments → تعديل النشر: " +
  "(1) التنفيذ من قبل = **أنا (Me)** وليس «مستخدم يصل إلى تطبيق الويب». " +
  "(2) من لديه إذن = **أي شخص (Anyone)** وليس «أي شخص لديه حساب Google». " +
  "ثم نشر. اختبر /exec في نافذة خاصة — يجب JSON مباشرة.";

const ERR_DNS_NETWORK =
  "لا يوجد اتصال بـ script.google.com من هذا الجهاز (فشل DNS أو الشبكة). " +
  "جرّب: التأكد من الإنترنت، إيقاف VPN مؤقتاً، في PowerShell: nslookup script.google.com " +
  "(يجب أن يظهر عنوان IP). إن فشل: غيّر DNS في إعدادات الشبكة إلى 8.8.8.8 أو 1.1.1.1. " +
  "هذا ليس خطأ في إعدادات نشر Google.";

function isRedirectToGoogleLogin(absoluteUrl) {
  return /accounts\.google\.com|ServiceLogin|\.google\.com\/(signin|o\/oauth2)/i.test(
    absoluteUrl
  );
}

function sendJsonGAS(res, code, success, errMsg) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(code);
  res.end(
    JSON.stringify({ success, error: errMsg != null ? errMsg : undefined })
  );
}

function readGas(u, res) {
  const start = u.includes("?") ? `${u}&_=${Date.now()}` : `${u}?_=${Date.now()}`;
  getOnce(start, 0, res);
}

function getOnce(url, depth, res) {
  if (depth > 10) {
    return sendJsonGAS(res, 502, false, "إعادة توجيه من GAS أكثر من الحد (حلقات 302؟)");
  }
  const client = url.startsWith("https") ? https : http;
  const req = client
    .get(
      url,
      {
        headers: {
          "User-Agent": "volunteer-dashboard-dev-proxy/1.0",
          Accept: "application/json, text/javascript, text/html, */*",
        },
      },
      (gRes) => {
        const code = gRes.statusCode || 0;
        if ([301, 302, 303, 307, 308].indexOf(code) >= 0 && gRes.headers.location) {
          let next;
          try {
            next = new URL(gRes.headers.location, url).href;
          } catch (e) {
            gRes.resume();
            return sendJsonGAS(res, 502, false, "Location غير صالح من GAS: " + gRes.headers.location);
          }
          gRes.resume();
          if (isRedirectToGoogleLogin(next)) {
            return sendJsonGAS(res, 200, false, ERR_GAS_AUTH);
          }
          return getOnce(next, depth + 1, res);
        }
        const chunks = [];
        gRes.on("data", (c) => chunks.push(c));
        gRes.on("end", () => {
          const body = Buffer.concat(chunks);
          if ([301, 302, 303, 307, 308].indexOf(code) < 0 && code === 200) {
            const head = body
              .toString("utf8", 0, Math.min(2500, body.length))
              .toLowerCase();
            if (head.indexOf("servicelogin") >= 0 || head.indexOf("accounts.google") >= 0) {
              return sendJsonGAS(res, 200, false, ERR_GAS_AUTH);
            }
          }
          if (code !== 200) {
            return sendJsonGAS(
              res,
              502,
              false,
              "GAS رد برمز " + code + ": " + body.toString("utf8").slice(0, 400)
            );
          }
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Content-Type", gRes.headers["content-type"] || "application/json; charset=utf-8");
          res.writeHead(200);
          res.end(body);
        });
      }
    )
    .on("error", (e) => {
      const code = e && e.code ? String(e.code) : "";
      const msg = e && e.message ? String(e.message) : String(e);
      if (
        code === "ENOTFOUND" ||
        /ENOTFOUND|getaddrinfo/i.test(msg)
      ) {
        return sendJsonGAS(res, 200, false, ERR_DNS_NETWORK + " [" + msg + "]");
      }
      if (code === "ETIMEDOUT" || code === "ECONNRESET") {
        return sendJsonGAS(
          res,
          200,
          false,
          "انقطع الاتصال بـ Google (" + code + "). تحقق من الشبكة أو الجدار الناري. " + msg
        );
      }
      send(res, 502, "text/plain; charset=utf-8", "Proxy error: " + msg);
    });
  req.setTimeout(60000, () => {
    req.destroy();
  });
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    return send(res, 400, "text/plain; charset=utf-8", "Bad request");
  }

  if (req.url.startsWith("/api/sheet?")) {
    const q = new URL(req.url, "http://x");
    const u = q.searchParams.get("u");
    if (!u || !u.startsWith("https://")) {
      return send(
        res,
        400,
        "text/plain; charset=utf-8",
        "Query ?u= must be a full https GAS /exec URL"
      );
    }
    return readGas(u, res);
  }

  if (req.url === "/api/health") {
    return send(res, 200, "text/plain; charset=utf-8", "ok");
  }

  let p = new URL(req.url, "http://x").pathname;
  if (p === "/") p = "/index.html";
  if (p.includes("..")) {
    return send(res, 403, "text/plain; charset=utf-8", "Forbidden");
  }
  const fp = path.join(ROOT, path.normalize(p));
  if (!fp.startsWith(ROOT)) {
    return send(res, 403, "text/plain; charset=utf-8", "Forbidden");
  }
  fs.readFile(fp, (err, data) => {
    if (err) {
      if (p !== "/index.html" && p.endsWith("/")) {
        return fs.readFile(path.join(ROOT, "index.html"), (e2, d2) => {
          if (e2) {
            return send(res, 404, "text/plain; charset=utf-8", "Not found");
          }
          return send(res, 200, MIME[".html"], d2);
        });
      }
      return send(res, 404, "text/plain; charset=utf-8", "Not found");
    }
    const ext = path.extname(fp);
    return send(res, 200, MIME[ext] || "application/octet-stream", data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Dev server: http://127.0.0.1:${PORT}/  (واجهة + /api/sheet — 0.0.0.0 للوصول من 192.168.x.x أيضاً)`
  );
});
