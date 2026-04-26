import {
  getGoogleScriptUrl,
  invalidGasUrlReason,
  isGoogleScriptUrlConfigured,
  isValidGASWebAppExecUrl,
} from "./config.js";

/**
 * JSONP: تحميل سكربت من GAS
 * @param {string} base
 * @returns {Promise<any>}
 */
function fetchJsonp(base) {
  return new Promise((resolve, reject) => {
    const cb =
      "volunteerJsonp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 12);
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("انتهت مهلة الاتصال (JSONP)."));
    }, 45000);

    /** @type {HTMLScriptElement | null} */
    let script = null;

    function cleanup() {
      clearTimeout(timeout);
      try {
        Reflect.deleteProperty(window, cb);
      } catch {
        // ignore
      }
      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }
      script = null;
    }

    window[cb] = function (data) {
      cleanup();
      resolve(data);
    };

    const sep = base.includes("?") ? "&" : "?";
    const url = `${base}${sep}callback=${encodeURIComponent(cb)}&_=${Date.now()}`;

    script = document.createElement("script");
    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error("تعذر تحميل سكربت الربط (JSONP)."));
    };
    script.src = url;
    document.head.appendChild(script);
  });
}

function normalizeSheetData(data) {
  if (data && data.error) {
    throw new Error(String(data.error));
  }
  if (data && data.success === false) {
    throw new Error(String(data.message || data.error || "خطأ من الخادم"));
  }
  if (data && Array.isArray(data.headers) && Array.isArray(data.rows)) {
    return { headers: data.headers, rows: data.rows };
  }
  if (data && data.values && Array.isArray(data.values)) {
    const all = data.values;
    if (all.length < 1) return { headers: [], rows: [] };
    return { headers: all[0], rows: all.slice(1) };
  }
  throw new Error("تنسيق الاستجابة غير متوقع. تأكد من تطابق Code.gs مع العميل.");
}

function parseResponseJsonText(text) {
  const start = text.trim().slice(0, 1);
  if (start === "<" || /^\s*<!DOCTYPE/i.test(text)) {
    const head = text.slice(0, 4000);
    if (
      /Sign in|Use your Google Account|Email or phone|accounts\.google\.com/i.test(
        head
      )
    ) {
      throw new Error(
        "النشر يطلب تسجيل دخول Google. في Apps Script: Deploy → Manage deployments → " +
          "Who has access: **Anyone** (بدون تسجيل). ثم افتح رابط /exec: يجب أن يظهر JSON."
      );
    }
    throw new Error(
      "الخادم أعاد HTML بدل JSON. اضبط Who has access = Anyone وأعد نشر Web App."
    );
  }
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/^[{\[]/.test(trimmed)) {
      const lower = trimmed.toLowerCase();
      if (/hello\s*from\s*api/i.test(trimmed)) {
        throw new Error(
          "رابط /exec صحيح، لكن مشروع **Google Apps Script** ما زال يردّ بنص تجريبي «Hello from API» وليس JSON. " +
            "افتح المشروع من الجدول (Extensions → Apps Script)، احذف أي doGet تجريبي، الصق كامل محتوى الملف " +
            "**google-apps-script/Code.gs** من مجلد المشروع على جهازك، ثم Save و Deploy → **نسخة جديدة**."
        );
      }
      const preview = trimmed.slice(0, 120).replace(/\s+/g, " ");
      throw new Error(
        "الاستجابة ليست JSON. إن كان الرابط يبدأ بـ https://script.google.com/macros/s/…/exec فالخلل في **كود** Apps Script " +
          "(الصق Code.gs من المشروع واحذف أي رد نصي تجريبي). وإلا الصق فقط رابط Web app من Deploy وليس /api محلياً. " +
          `مقتطف: «${preview}${trimmed.length > 120 ? "…" : ""}». (${msg})`
      );
    }
    throw new Error(`الاستجابة ليست JSON صالحاً: ${msg}`);
  }
}

function isNetworkError(err) {
  if (err instanceof TypeError) return true;
  const m = err && err.message != null ? String(err.message) : "";
  return /Failed to fetch|Load failed|NetworkError|net::/i.test(m);
}

/**
 * @returns {boolean} تطوير محلي (ليس file://) — لاستخدام /api/sheet مع dev-server
 * يتضمّن 192.168.x.x إذا فتحت الصفحة من IP الشبكة المحلية
 */
function isLocalDevHostname() {
  if (typeof location === "undefined" || !location.protocol.startsWith("http")) {
    return false;
  }
  const h = location.hostname;
  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "[::1]" ||
    h === "::1"
  ) {
    return true;
  }
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) {
    return true;
  }
  return false;
}

/**
 * ينجح فقط عند استخدام `node dev-server.cjs` (ليس npx serve فقط)
 * @param {string} base
 * @returns {Promise<{ done: true, result: { headers: string[], rows: any[][] } } | { done: false }>}
 */
async function tryLocalApiProxyFirst(base) {
  if (!isLocalDevHostname()) {
    return { done: false };
  }
  let pr;
  try {
    pr = await fetch(
      `/api/sheet?u=${encodeURIComponent(base)}`,
      { method: "GET", cache: "no-store", credentials: "omit" }
    );
  } catch {
    return { done: false };
  }

  if (pr.status === 404) {
    return { done: false };
  }

  const text = await pr.text();
  if (!pr.ok) {
    const hint =
      text && /ENOTFOUND|getaddrinfo/i.test(text)
        ? " (المشكلة شبكة/DNS على جهازك وليست إعدادات Google.)"
        : "";
    throw new Error(
      "الوكيل المحلي (node dev-server) تلقى خطأ من GAS. " +
        `رمز: ${pr.status}. إن لم يكن ENOTFOUND: تحقق من رابط /exec و Me + Anyone في النشر.` +
        hint +
        (text ? " " + text.slice(0, 500) : "")
    );
  }
  return {
    done: true,
    result: normalizeSheetData(parseResponseJsonText(text)),
  };
}

/**
 * جلب بيانات الجدول من Web App
 * @returns {Promise<{ headers: string[], rows: any[][] }>}
 */
export async function fetchVolunteerSheet() {
  if (!isGoogleScriptUrlConfigured()) {
    throw new Error("يرجى ربط رابط Google Apps Script (من اللوحة أعلاه أو في js/config.js).");
  }

  const base = getGoogleScriptUrl();
  if (!isValidGASWebAppExecUrl(base)) {
    throw new Error(invalidGasUrlReason(base));
  }

  // ① على localhost: اطلب GAS عبر خادمنا أولاً (يتجاهل CORS) — `node dev-server.cjs`
  const fromProxy = await tryLocalApiProxyFirst(base);
  if (fromProxy.done) {
    return fromProxy.result;
  }

  const url = base.includes("?")
    ? `${base}&_=${Date.now()}`
    : `${base}?_=${Date.now()}`;

  let data;
  try {
    const res = await fetch(url, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
    });

    if (!res.ok) {
      throw new Error(`فشل الطلب: ${res.status} ${res.statusText}`);
    }

    const text = await res.text();
    data = parseResponseJsonText(text);
  } catch (err) {
    if (!isNetworkError(err)) {
      throw err;
    }
    if (isLocalDevHostname()) {
      try {
        const pr = await fetch(
          `/api/sheet?u=${encodeURIComponent(base)}`,
          { method: "GET", cache: "no-store", credentials: "omit" }
        );
        if (pr.ok) {
          return normalizeSheetData(
            parseResponseJsonText(await pr.text())
          );
        }
      } catch {
        // ignore
      }
    }
    try {
      data = await fetchJsonp(base);
    } catch {
      throw new Error(
        isLocalDevHostname()
          ? "تعذر الاتصال. تأكد من: ① **node dev-server.cjs** من جذر المشروع (أو volunteer-dashboard) " +
            "وافتح **نفس** المنفذ (مثلاً http://127.0.0.1:8080 إن استخدمت PORT=8080). ② " +
            "**Who has access = Anyone** في نشر GAS. ③ أوقف `npx serve` إن كان نفس المنفذ. " +
            `(${String(err && err.message ? err.message : err)})`
          : "تعذر الاتصال بـ Web App. جرّب: **Anyone**، تحديث Code.gs، عطيل حظر التتبع. " +
            `(${String(err && err.message ? err.message : err)})`
      );
    }
  }

  return normalizeSheetData(data);
}
