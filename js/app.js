/**
 * تطبيق لوحة المتطوعين — واجهة، بحث، فلاتر، Modal، تحديث
 */
import {
  invalidGasUrlReason,
  isGoogleScriptUrlConfigured,
  isValidGASWebAppExecUrl,
  SEARCH_DEBOUNCE_MS,
  AUTOCOMPLETE_MAX,
  DASHBOARD_AUTH_DISABLED,
  AUTH_SESSION_STORAGE_KEY,
  AUTH_SESSION_VALUE,
  dashboardCredentialsMatch,
} from "./config.js";
import { fetchVolunteerSheet } from "./api.js";
import {
  mapSheetDataToVolunteers,
  caseInsensitiveIncludes,
  normalizeGenderForFilter,
} from "./volunteerModel.js";
import { downloadVolunteerPdf, downloadOfficeExcel } from "./export.js";

/** @type {import('./types.js').Volunteer[]} */
let allVolunteers = [];
let debounceId = 0;
/** @type {import('./types.js').Volunteer | null} */
let modalVolunteer = null;
let activeAutocompleteIndex = -1;

const els = {
  loginGate: document.getElementById("login-gate"),
  loginForm: /** @type {HTMLFormElement | null} */ (document.getElementById("login-form")),
  loginUsername: /** @type {HTMLInputElement | null} */ (document.getElementById("login-username")),
  loginPassword: /** @type {HTMLInputElement | null} */ (document.getElementById("login-password")),
  loginError: document.getElementById("login-error"),
  appRoot: document.getElementById("app"),
  search: /** @type {HTMLInputElement} */ (document.getElementById("search-input")),
  autocomplete: document.getElementById("autocomplete-list"),
  filterGender: /** @type {HTMLSelectElement} */ (document.getElementById("filter-gender")),
  filterOffice: /** @type {HTMLSelectElement} */ (document.getElementById("filter-office")),
  tableBody: document.getElementById("table-body"),
  rowCount: document.getElementById("row-count"),
  statusBar: document.getElementById("status-bar"),
  loading: document.getElementById("loading-overlay"),
  error: document.getElementById("error-message"),
  apiSetup: document.getElementById("api-setup"),
  apiUrlInput: /** @type {HTMLInputElement | null} */ (document.getElementById("api-url-input")),
  apiUrlSave: document.getElementById("api-url-save"),
  btnLogout: document.getElementById("btn-logout"),
  btnRefresh: document.getElementById("btn-refresh"),
  btnExcel: document.getElementById("btn-excel-office"),
  modal: document.getElementById("modal"),
  modalBackdrop: document.getElementById("modal-backdrop"),
  modalBody: document.getElementById("modal-body"),
  modalTitle: document.getElementById("modal-title"),
  btnPdf: document.getElementById("btn-pdf"),
  modalClose: document.getElementById("modal-close"),
  modalCloseFooter: document.getElementById("modal-close-footer"),
};

/**
 * @returns {import('./types.js').Volunteer[]}
 */
function getFiltered() {
  const q = (els.search.value || "").trim();
  const gender = els.filterGender.value;
  const office = els.filterOffice.value;

  return allVolunteers.filter((v) => {
    if (gender === "male" && normalizeGenderForFilter(v.gender) !== "male") return false;
    if (gender === "female" && normalizeGenderForFilter(v.gender) !== "female") return false;
    if (office && office !== "all") {
      if (!v.office) return false;
      const a = v.office.trim().toLowerCase();
      const b = String(office).trim().toLowerCase();
      if (a !== b) return false;
    }
    if (q) {
      const m =
        caseInsensitiveIncludes(v.name, q) ||
        caseInsensitiveIncludes(v.phone, q) ||
        caseInsensitiveIncludes(v.email, q);
      if (!m) return false;
    }
    return true;
  });
}

function setStatus(msg, isError) {
  els.statusBar.textContent = msg || "";
  if (isError) els.statusBar.setAttribute("data-error", "1");
  else els.statusBar.removeAttribute("data-error");
}

function setLoading(on) {
  els.loading.classList.toggle("hidden", !on);
  els.loading.setAttribute("aria-hidden", on ? "false" : "true");
}

function setError(msg) {
  if (msg) {
    els.error.textContent = msg;
    els.error.classList.remove("hidden");
  } else {
    els.error.textContent = "";
    els.error.classList.add("hidden");
  }
}

const STATUS_AR = { student: "طالب", graduate: "خريج" };

/**
 * @param {import('./types.js').Volunteer} v
 */
function renderTableRow(v) {
  const tr = document.createElement("tr");
  tr.setAttribute("role", "row");
  tr.innerHTML = `
    <td>${escapeHtml(v.name || "—")}</td>
    <td>${escapeHtml(v.phone || "—")}</td>
    <td>${escapeHtml(v.gender || "—")}</td>
    <td>${escapeHtml(v.office || "—")}</td>
    <td>${escapeHtml(v.status ? STATUS_AR[v.status] || v.status : "—")}</td>
  `;
  tr.addEventListener("click", () => openModal(v));
  return tr;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function renderTable() {
  const list = getFiltered();
  els.tableBody.replaceChildren();
  if (list.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td colspan="5" class="table-placeholder">لا توجد نتائج تطابق الفلاتر.</td>';
    els.tableBody.appendChild(tr);
  } else {
    list.forEach((v) => els.tableBody.appendChild(renderTableRow(v)));
  }
  els.rowCount.textContent = `العرض: ${list.length} من ${allVolunteers.length}`;
}

/**
 * @param {import('./types.js').Volunteer} v
 */
function openModal(v) {
  modalVolunteer = v;
  els.modalTitle.textContent = v.name || "تفاصيل المتطوع";
  const blocks = buildDetailFields(v);
  els.modalBody.innerHTML = blocks;
  els.modal.classList.remove("hidden");
  els.modalBackdrop.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  els.btnPdf.focus();
}

function closeModal() {
  modalVolunteer = null;
  els.modal.classList.add("hidden");
  els.modalBackdrop.classList.add("hidden");
  document.body.style.overflow = "";
}

function dash(s) {
  return s != null && String(s).trim() !== "" ? String(s) : "—";
}

/**
 * @param {import('./types.js').Volunteer} v
 */
function buildDetailFields(v) {
  const base = [
    { label: "الاسم الثلاثي", value: dash(v.name) },
    { label: "البريد", value: dash(v.email) },
    { label: "الهاتف", value: dash(v.phone) },
    { label: "الجنس", value: dash(v.gender) },
    { label: "تاريخ الميلاد", value: dash(v.birthDate) },
    { label: "مكان الإقامة", value: dash(v.location) },
    { label: "زمرة الدم", value: dash(v.bloodType) },
    { label: "المكتب", value: dash(v.office) },
    {
      label: "الوضع الدراسي",
      value: dash(v.status ? STATUS_AR[v.status] || v.status : ""),
    },
  ];
  if (v.status === "student") {
    base.push(
      { label: "الجامعة", value: dash(v.university) },
      { label: "الاختصاص", value: dash(v.major) },
      { label: "السنة الدراسية", value: dash(v.studyYear) }
    );
  } else if (v.status === "graduate") {
    base.push(
      { label: "تاريخ التخرج", value: dash(v.graduationDate) },
      { label: "الاختصاص", value: dash(v.major) }
    );
  } else {
    base.push(
      { label: "الجامعة", value: dash(v.university) },
      { label: "الاختصاص", value: dash(v.major) },
      { label: "السنة الدراسية", value: dash(v.studyYear) },
      { label: "تاريخ التخرج", value: dash(v.graduationDate) }
    );
  }
  return (
    '<div class="detail-grid">' +
    base
      .map(
        (f) => `
    <div class="detail-row">
      <span class="detail-label">${escapeHtml(f.label)}</span>
      <span class="detail-value">${escapeHtml(String(f.value))}</span>
    </div>
  `
      )
      .join("") +
    "</div>"
  );
}

/**
 * @returns {import('./types.js').Volunteer[]}
 */
function nameSuggestions(prefix) {
  if (!prefix || prefix.length < 1) return [];
  const p = prefix.toLowerCase().trim();
  const seen = new Set();
  const out = [];
  for (const v of allVolunteers) {
    const n = (v.name || "").trim();
    if (!n) continue;
    if (n.toLowerCase().includes(p) && !seen.has(n)) {
      seen.add(n);
      out.push(v);
      if (out.length >= AUTOCOMPLETE_MAX) break;
    }
  }
  return out;
}

function renderAutocomplete() {
  const v = (els.search.value || "").trim();
  const list = nameSuggestions(v);
  els.autocomplete.replaceChildren();
  if (list.length === 0 || v.length < 1) {
    els.autocomplete.classList.add("hidden");
    return;
  }
  list.forEach((row, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    li.textContent = row.name;
    li.dataset.index = String(i);
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      selectSuggestion(row);
    });
    els.autocomplete.appendChild(li);
  });
  els.autocomplete.classList.remove("hidden");
  activeAutocompleteIndex = -1;
}

/**
 * @param {import('./types.js').Volunteer} v
 */
function selectSuggestion(v) {
  els.search.value = v.name;
  hideAutocomplete();
  renderTable();
  openModal(v);
}

function hideAutocomplete() {
  els.autocomplete.classList.add("hidden");
  els.autocomplete.replaceChildren();
  activeAutocompleteIndex = -1;
}

/**
 * @param {() => void} fn
 * @param {number} wait
 */
function debounce(fn, wait) {
  return () => {
    clearTimeout(debounceId);
    debounceId = window.setTimeout(fn, wait);
  };
}

function rebuildOfficeOptions() {
  const set = new Set();
  allVolunteers.forEach((v) => {
    if (v.office && v.office.trim()) set.add(v.office.trim());
  });
  const arr = Array.from(set).sort((a, b) => a.localeCompare(b, "ar"));
  const current = els.filterOffice.value;
  els.filterOffice.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "الكل";
  els.filterOffice.appendChild(optAll);
  arr.forEach((o) => {
    const oEl = document.createElement("option");
    oEl.value = o;
    oEl.textContent = o;
    els.filterOffice.appendChild(oEl);
  });
  if (current && (current === "all" || set.has(current))) {
    els.filterOffice.value = current;
  } else {
    els.filterOffice.value = "all";
  }
}

async function loadData() {
  setError("");
  setLoading(true);
  setStatus("جاري الاتصال بالخادم…", false);
  try {
    const raw = await fetchVolunteerSheet();
    allVolunteers = mapSheetDataToVolunteers(raw);
    rebuildOfficeOptions();
    renderTable();
    setStatus(
      `آخر تحديث: ${new Date().toLocaleString("ar-SY")} — ${allVolunteers.length} سجل`,
      false
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setError(msg);
    setStatus("تعذر التحميل.", true);
  } finally {
    setLoading(false);
  }
}

function wireEvents() {
  const onSearch = debounce(() => {
    renderTable();
    renderAutocomplete();
  }, SEARCH_DEBOUNCE_MS);

  els.search.addEventListener("input", () => {
    onSearch();
  });
  els.search.addEventListener("focus", () => {
    if ((els.search.value || "").trim().length >= 1) renderAutocomplete();
  });
  els.search.addEventListener("blur", () => {
    setTimeout(() => hideAutocomplete(), 200);
  });
  els.search.addEventListener("keydown", (e) => {
    const items = Array.from(els.autocomplete.querySelectorAll("li"));
    if (els.autocomplete.classList.contains("hidden") || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeAutocompleteIndex = Math.min(activeAutocompleteIndex + 1, items.length - 1);
      items.forEach((el, i) => {
        el.setAttribute("aria-selected", i === activeAutocompleteIndex ? "true" : "false");
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeAutocompleteIndex = Math.max(activeAutocompleteIndex - 1, 0);
      items.forEach((el, i) => {
        el.setAttribute("aria-selected", i === activeAutocompleteIndex ? "true" : "false");
      });
    } else if (e.key === "Enter" && activeAutocompleteIndex >= 0) {
      e.preventDefault();
      const n = (items[activeAutocompleteIndex].textContent || "").trim();
      const v = allVolunteers.find((x) => (x.name || "").trim() === n);
      if (v) selectSuggestion(v);
    } else if (e.key === "Escape") {
      hideAutocomplete();
    }
  });

  els.filterGender.addEventListener("change", () => renderTable());
  els.filterOffice.addEventListener("change", () => renderTable());

  if (els.btnLogout) {
    els.btnLogout.addEventListener("click", () => {
      try {
        sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
      } catch {
        // تجاهل
      }
      window.location.reload();
    });
  }

  els.btnRefresh.addEventListener("click", () => {
    if (!isGoogleScriptUrlConfigured()) {
      if (els.apiSetup) els.apiSetup.classList.remove("hidden");
      setError("عيّن رابط Web App أدناه أولاً.");
      return;
    }
    loadData();
  });

  if (els.apiUrlSave && els.apiUrlInput) {
    const saveApiUrl = () => {
      const v = (els.apiUrlInput.value || "").trim();
      if (!/^https?:\/\//i.test(v)) {
        setError("الصق رابطاً كاملاً يبدأ بـ https://");
        return;
      }
      if (!isValidGASWebAppExecUrl(v)) {
        setError(invalidGasUrlReason(v));
        return;
      }
      localStorage.setItem("VOLUNTEER_GOOGLE_SCRIPT_URL", v);
      if (els.apiSetup) els.apiSetup.classList.add("hidden");
      setError("");
      loadData();
    };
    els.apiUrlSave.addEventListener("click", saveApiUrl);
    els.apiUrlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveApiUrl();
      }
    });
  }

  els.btnExcel.addEventListener("click", () => {
    try {
      const office = els.filterOffice.value || "all";
      // Excel حسب المكتب المحدد في القائمة (وليس نتيجة البحث الحالية)
      downloadOfficeExcel(allVolunteers, office);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });

  [els.modalClose, els.modalCloseFooter, els.modalBackdrop].forEach((n) => {
    n.addEventListener("click", (e) => {
      if (e.target === els.modalBackdrop || e.currentTarget === els.modalClose || e.currentTarget === els.modalCloseFooter) {
        closeModal();
      }
    });
  });

  els.btnPdf.addEventListener("click", () => {
    if (!modalVolunteer) return;
    try {
      downloadVolunteerPdf(modalVolunteer);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });
}

function hasAuthSession() {
  try {
    return sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY) === AUTH_SESSION_VALUE;
  } catch {
    return false;
  }
}

function showDashboardShell() {
  if (els.loginGate) els.loginGate.classList.add("hidden");
  if (els.appRoot) {
    els.appRoot.classList.remove("hidden");
    els.appRoot.removeAttribute("aria-hidden");
  }
}

function showLoginShell() {
  if (els.loginGate) els.loginGate.classList.remove("hidden");
  if (els.appRoot) {
    els.appRoot.classList.add("hidden");
    els.appRoot.setAttribute("aria-hidden", "true");
  }
}

function setLoginError(msg) {
  if (!els.loginError) return;
  if (msg) {
    els.loginError.textContent = msg;
    els.loginError.classList.remove("hidden");
  } else {
    els.loginError.textContent = "";
    els.loginError.classList.add("hidden");
  }
}

function wireLoginForm() {
  if (!els.loginForm || !els.loginUsername || !els.loginPassword) return;
  els.loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    setLoginError("");
    const u = els.loginUsername.value;
    const p = els.loginPassword.value;
    if (!dashboardCredentialsMatch(u, p)) {
      setLoginError("اسم المستخدم أو كلمة المرور غير صحيحة.");
      return;
    }
    try {
      sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, AUTH_SESSION_VALUE);
    } catch {
      setLoginError("تعذر حفظ الجلسة. تحقق من إعدادات المتصفح.");
      return;
    }
    els.loginPassword.value = "";
    showDashboardShell();
    startDashboard();
  });
}

let dashboardWired = false;

function startDashboard() {
  if (!dashboardWired) {
    wireEvents();
    dashboardWired = true;
  }
  if (!isGoogleScriptUrlConfigured()) {
    setError("");
    if (els.apiSetup) els.apiSetup.classList.remove("hidden");
    setStatus("ألصق رابط Web App من Google Apps Script ثم اضغط «حفظ وتحميل».", false);
  } else {
    if (els.apiSetup) els.apiSetup.classList.add("hidden");
    loadData();
  }
}

function init() {
  if (DASHBOARD_AUTH_DISABLED) {
    if (els.btnLogout) els.btnLogout.classList.add("hidden");
    showDashboardShell();
    startDashboard();
    return;
  }
  if (hasAuthSession()) {
    showDashboardShell();
    startDashboard();
    return;
  }
  showLoginShell();
  wireLoginForm();
  if (els.loginUsername) els.loginUsername.focus();
}

init();
