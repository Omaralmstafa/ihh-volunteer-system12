/**
 * الاتصال بـ Google Apps Script (Web App)
 *
 * نشر Web App (مرّة واحدة من حسابك):
 * 1) افتح الجدول → Extensions → Apps Script
 * 2) انسق google-apps-script/Code.gs ثم Save (حفظ)
 * 3) Deploy → New deployment → اختر type: Web app
 * 4) Execute as: **Me (أنا)** — ليس «User accessing the web app»
 * 5) Who has access: **Anyone (أي شخص)** — ليس «Anyone with a Google account»
 *    — وإلا يعيد الرابط صفحة تسجيل HTML ولن يعمل fetch من الموقع
 * 6) Deploy → انسخ "Web app URL" (الصيغة: …/script.google.com/macros/s/.../exec)
 * 7) الصقه أدناه في HARDCODED_URL أو في حقل الواجهة
 *
 * بدون تعديل الملف بعد أول مرة: من وحدة التحكم في المتصفح:
 *   localStorage.setItem("VOLUNTEER_GOOGLE_SCRIPT_URL", "https://script.google.com/.../exec");
 * ثم أعد تحميل الصفحة.
 *
 * للاختبار السريع من الرابط: ?gscript=ENCODED_URL
 *
 * إذا ظهر «Failed to fetch» من المتصفح: من جذر المشروع شغّل
 *   node dev-server.cjs
 * ثم افتح http://127.0.0.1:8080 — الخادم يمرّر طلبات GAS عبر /api/sheet (بدون CORS).
 */
export const PLACEHOLDER_SCRIPT_URL = "YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";

const HARDCODED_URL =
  "https://script.google.com/macros/s/AKfycby4wGLCw8aF18EWnJ0x211oy1UEhTqQaqEdVFIbqU3ne6wc_i2MkQ-iRM7JIaqNaqw0/exec";

function resolveScriptUrl() {
  if (HARDCODED_URL && HARDCODED_URL !== PLACEHOLDER_SCRIPT_URL) {
    return HARDCODED_URL.trim();
  }
  try {
    if (typeof window !== "undefined") {
      const fromQuery = new URLSearchParams(window.location.search).get("gscript");
      if (fromQuery) {
        return decodeURIComponent(fromQuery).trim();
      }
      const fromStorage = window.localStorage.getItem("VOLUNTEER_GOOGLE_SCRIPT_URL");
      if (fromStorage) {
        return fromStorage.trim();
      }
    }
  } catch {
    // تجاهل في بيئات غير متصفح
  }
  return HARDCODED_URL;
}

/**
 * رابط نشر Web App الحقيقي ينتهي بـ /exec (وليس /dev أو /edit أو صفحة المحرر).
 * يدعم: script.google.com/macros/s/ID/exec
 *       script.google.com/a/DOMAIN/macros/s/ID/exec
 *
 * @param {string} u
 * @returns {boolean}
 */
export function isValidGASWebAppExecUrl(u) {
  if (!u || typeof u !== "string") return false;
  try {
    const url = new URL(u.trim());
    if (url.protocol !== "https:" || url.hostname !== "script.google.com") {
      return false;
    }
    const p = url.pathname;
    if (!p.endsWith("/exec") && !p.endsWith("/exec/")) {
      return false;
    }
    if (/\/dev(\/|$)/.test(p)) {
      return false;
    }
    if (p.includes("/macros/s/") && p.match(/\/macros\/s\/[^/]+\/exec\/?$/)) {
      return true;
    }
    return p.includes("/macros/s/") && p.includes("/exec");
  } catch {
    return false;
  }
}

/**
 * سبب رفض الرابط (لعرضه للمستخدم) — مثلاً رابط مكتبة بدل Web app
 * @param {string} u
 * @returns {string}
 */
export function invalidGasUrlReason(u) {
  if (!u || typeof u !== "string") {
    return "الرابط فارغ.";
  }
  let url;
  try {
    url = new URL(u.trim());
  } catch {
    return "تنسيق الرابط غير صالح.";
  }
  if (url.protocol !== "https:" || url.hostname !== "script.google.com") {
    return "يجب أن يبدأ الرابط بـ https://script.google.com/";
  }
  if (url.pathname.includes("/macros/library/")) {
    return (
      "هذا رابط **مكتبة** (Library) وليس **Web app**. اللوحة تحتاج رابط النشر من Deploy " +
      "الذي يحتوي **/macros/s/** وينتهي بـ **/exec** فقط، وليس …/macros/library/…"
    );
  }
  if (!isValidGASWebAppExecUrl(u)) {
    return (
      "الصيغة المطلوبة: https://script.google.com/macros/s/معرّف/exec " +
      "(أو مع مسار /a/نطاقك/… في Workspace)."
    );
  }
  return "رابط غير صالح.";
}

/**
 * @returns {string} يُستدعى عند كل طلب ليَقرأ localStorage إن وُجد بعد الحفظ من الواجهة
 */
export function getGoogleScriptUrl() {
  return resolveScriptUrl();
}

/**
 * @returns {boolean}
 */
export function isGoogleScriptUrlConfigured() {
  const u = getGoogleScriptUrl();
  if (!u || u === PLACEHOLDER_SCRIPT_URL) return false;
  if (!/^https?:\/\//i.test(u)) return false;
  return isValidGASWebAppExecUrl(u);
}

/** تأخير البحث (ms) */
export const SEARCH_DEBOUNCE_MS = 250;

/** حد اقتراحات الـ Autocomplete */
export const AUTOCOMPLETE_MAX = 12;
