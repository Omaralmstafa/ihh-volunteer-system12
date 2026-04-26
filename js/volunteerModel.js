/**
 * تحويل صف من الجدول إلى كائن موحّد + تجاهل الأعمدة المكرّرة (أخذ أول قيمة غير فارغة)
 */

/** أنماط مطابقة الأعمدة (ترتيب الأولوية: الأكثر خصوصية أولاً) */
const COLUMN_RULES = [
  { key: "name", matchers: [/^الاسم\s*الثلاثي$/, /الاسم/, /^name$/i, /full\s*name/i] },
  { key: "email", matchers: [/الايميل|الإيميل|البريد/i, /^email$/i] },
  { key: "phone", matchers: [/رقم\s*الهاتف|الهاتف|الجوال|موبايل/i, /^phone$|^mobile$|^tel$/i] },
  { key: "gender", matchers: [/^الجنس$/, /^gender$/i] },
  { key: "birthDate", matchers: [/تاريخ\s*الميلاد/i, /^birth/i, /^dob$/i] },
  { key: "location", matchers: [/مكان\s*الاقامة|مكان الإقامة|السكن|العنوان/i, /^location$/i, /^address$/i] },
  { key: "bloodType", matchers: [/زمرة\s*الدم|فصيلة/i, /^blood/i] },
  { key: "office", matchers: [/المكتب\s*المتطوع|المكتب/i, /^office$/i] },
  { key: "status", matchers: [/الوضع\s*الدراسي|الحالة\s*الدراسية|الوضع/i, /^status$/i, /^academic/i] },
  { key: "university", matchers: [/^الجامعة$/, /الجامعة.*تدرس|تدرس\s*بها/i, /^university$/i] },
  { key: "major", matchers: [/^الاختصاص$|التخصص|الاختصاص|المجال/i, /^major$|^field$/i] },
  { key: "studyYear", matchers: [/السنة\s*الدراسية|السنة الدراسية|المرحلة/i, /study\s*year/i, /^year$/i] },
  { key: "graduationDate", matchers: [/تاريخ\s*التخرج/i, /^grad(uation)?\s*date$/i] },
];

/**
 * @param {string} header
 * @returns {string|null}
 */
function mapHeaderToKey(header) {
  if (header == null) return null;
  const h = String(header).trim();
  if (!h) return null;
  const norm = h.replace(/\s+/g, " ");
  for (const rule of COLUMN_RULES) {
    for (const re of rule.matchers) {
      if (re.test(norm)) return rule.key;
    }
  }
  return null;
}

/**
 * يبني تخطيط أعمدة: لكل key أول عمود يطابق (تجاهل التكرار لاحقاً)
 * @param {string[]} rawHeaders
 * @returns {Map<string, number>}
 */
export function buildColumnMap(rawHeaders) {
  const colMap = new Map();
  for (let i = 0; i < rawHeaders.length; i++) {
    const key = mapHeaderToKey(rawHeaders[i]);
    if (key && !colMap.has(key)) colMap.set(key, i);
  }
  return colMap;
}

/**
 * تطبيع نص "الوضع الدراسي" إلى student | graduate
 * @param {string} s
 * @returns {"student"|"graduate"|""}
 */
function normalizeStatus(s) {
  if (s == null || String(s).trim() === "") return "";
  const t = String(s).toLowerCase();
  if (/طالب|طالبة|student|undergrad/i.test(t)) return "student";
  if (/خريج|خريجة|graduate|alumni|bachelor|master/i.test(t)) return "graduate";
  return "";
}

/**
 * تطبيع الجنس لاستخدام الفلترة: male / female
 * @param {string} s
 * @returns {"male"|"female"|""}
 */
export function normalizeGenderForFilter(s) {
  if (s == null) return "";
  const t = String(s).toLowerCase();
  if (/ذكر|male|^m$|^m\.|رجل/i.test(t)) return "male";
  if (/أنثى|انثى|انث|female|^f$|^f\.|مؤنث|امرأة|مرأة/i.test(t)) return "female";
  return "";
}

/**
 * من صف قيم + خريطة أعمدة → Volunteer
 * @param {any[]} row
 * @param {Map<string, number>} colMap
 * @returns {import('./types.js').Volunteer}
 */
export function rowToVolunteer(row, colMap) {
  const g = (key) => {
    const idx = colMap.get(key);
    if (idx == null) return "";
    const v = row[idx];
    if (v == null) return "";
    if (v instanceof Date) {
      return v.toISOString().split("T")[0];
    }
    return String(v).trim();
  };

  const statusRaw = g("status");
  const st = normalizeStatus(statusRaw) || (statusRaw ? "graduate" : "");

  const v = {
    name: g("name"),
    email: g("email"),
    phone: g("phone"),
    gender: g("gender"),
    birthDate: g("birthDate"),
    location: g("location"),
    bloodType: g("bloodType"),
    office: g("office"),
    status: st,
    university: "",
    major: "",
    studyYear: "",
    graduationDate: "",
  };

  if (v.status === "student") {
    v.university = g("university");
    v.major = g("major");
    v.studyYear = g("studyYear");
  } else if (v.status === "graduate" || (statusRaw && /خريج/i.test(String(statusRaw)))) {
    v.graduationDate = g("graduationDate");
    v.major = g("major");
    v.status = "graduate";
  } else {
    v.university = g("university");
    v.major = g("major");
    v.studyYear = g("studyYear");
    v.graduationDate = g("graduationDate");
  }

  return v;
}

/**
 * @param {string[][]|object[]} input — إما { headers, rows } من الـ API أو مصفوفة أصناف
 * @returns {import('./types.js').Volunteer[]}
 */
export function mapSheetDataToVolunteers(input) {
  let headers;
  let rows;
  if (Array.isArray(input)) {
    if (input.length < 1) return [];
    headers = input[0].map((h) => String(h ?? "").trim());
    rows = input.slice(1);
  } else if (input && input.headers && input.rows) {
    headers = input.headers.map((h) => String(h ?? "").trim());
    rows = input.rows;
  } else {
    return [];
  }

  const colMap = buildColumnMap(headers);
  return rows
    .map((r) => (Array.isArray(r) ? r : Object.values(r)))
    .map((row) => rowToVolunteer(row, colMap))
    .filter((v) => v.name || v.email || v.phone);
}

/**
 * بحث غير حساس لحروف: مقارنة نصوص مُنَرَّمة
 * @param {string} a
 * @param {string} b
 */
export function caseInsensitiveIncludes(a, b) {
  if (!a || !b) return false;
  return String(a).toLowerCase().includes(String(b).toLowerCase().trim());
}
