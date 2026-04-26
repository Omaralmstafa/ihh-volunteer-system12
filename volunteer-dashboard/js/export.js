/* global jspdf, XLSX */

const STATUS_AR = { student: "طالب", graduate: "خريج" };

/**
 * @param {import('./types.js').Volunteer} v
 */
function volunteerLines(v) {
  const lines = [
    ["الاسم الثلاثي", v.name || "—"],
    ["البريد", v.email || "—"],
    ["الهاتف", v.phone || "—"],
    ["الجنس", v.gender || "—"],
    ["تاريخ الميلاد", v.birthDate || "—"],
    ["مكان الإقامة", v.location || "—"],
    ["زمرة الدم", v.bloodType || "—"],
    ["المكتب", v.office || "—"],
    ["الوضع الدراسي", v.status ? STATUS_AR[v.status] || v.status : "—"],
  ];
  if (v.status === "student") {
    lines.push(
      ["الجامعة", v.university || "—"],
      ["الاختصاص", v.major || "—"],
      ["السنة الدراسية", v.studyYear || "—"]
    );
  } else if (v.status === "graduate") {
    lines.push(
      ["تاريخ التخرج", v.graduationDate || "—"],
      ["الاختصاص", v.major || "—"]
    );
  } else {
    if (v.university) lines.push(["الجامعة", v.university]);
    if (v.major) lines.push(["الاختصاص", v.major]);
    if (v.studyYear) lines.push(["السنة الدراسية", v.studyYear]);
    if (v.graduationDate) lines.push(["تاريخ التخرج", v.graduationDate]);
  }
  return lines;
}

function sameOffice(a, b) {
  if (a == null || b == null) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * يقسّم النص إلى أسطر بعرض maxPx
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxPx
 */
function wrapLines(ctx, text, maxPx) {
  const t = (text + "").replace(/\s+/g, " ").trim();
  const words = t.split(" ");
  const out = [];
  let line = "";
  for (const w0 of words) {
    const test = line + (line ? " " : "") + w0;
    if (ctx.measureText(test).width <= maxPx) line = test;
    else {
      if (line) out.push(line);
      line = w0;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

/**
 * @param {import('./types.js').Volunteer} v
 * @param {string} [filename]
 */
export function downloadVolunteerPdf(v, filename) {
  const { jsPDF } = window.jspdf;
  const W = 820;
  const pad = 32;
  const lineH = 24;
  const maxTextW = W - 2 * pad;
  const rows = volunteerLines(v);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 4000;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذر إنشاء Canvas.");

  const title = "بيانات المتطوع";
  ctx.font = "bold 24px Tajawal, Tahoma, Arial, sans-serif";
  const titleLines = wrapLines(ctx, title, maxTextW);
  let yMeasure = titleLines.length * 32 + 12;
  ctx.font = "16px Tajawal, Tahoma, Arial, sans-serif";
  for (const [label, value] of rows) {
    const combined = label + " : " + value;
    const partLines = wrapLines(ctx, combined, maxTextW);
    yMeasure += partLines.length * lineH + 6;
  }

  const H = Math.max(200, yMeasure + pad * 2);
  canvas.height = H;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.direction = "rtl";
  let yy = pad;
  ctx.fillStyle = "#0f1419";
  ctx.font = "bold 24px Tajawal, Tahoma, Arial, sans-serif";
  titleLines.forEach((ln) => {
    ctx.fillText(ln, W - pad, yy, maxTextW);
    yy += 32;
  });
  yy += 12;
  ctx.font = "16px Tajawal, Tahoma, Arial, sans-serif";
  for (const [label, value] of rows) {
    const combined = label + " : " + value;
    const partLines = wrapLines(ctx, combined, maxTextW);
    partLines.forEach((ln) => {
      ctx.fillStyle = "#0f1419";
      ctx.fillText(ln, W - pad, yy, maxTextW);
      yy += lineH;
    });
    yy += 6;
  }

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 8;
  const maxImgW = pageW - 2 * margin;
  const y0 = margin;
  const totalHmm = (H * maxImgW) / W;
  const maxPageHmm = pageH - 2 * margin;
  if (totalHmm <= maxPageHmm) {
    doc.addImage(canvas.toDataURL("image/png", 0.95), "PNG", margin, y0, maxImgW, totalHmm);
  } else {
    let yMm = 0;
    while (yMm < totalHmm - 0.5) {
      if (yMm > 0) doc.addPage();
      const chunkHmm = Math.min(maxPageHmm, totalHmm - yMm);
      const srcY = (yMm / totalHmm) * H;
      const srcH = (chunkHmm / totalHmm) * H;
      const sCanvas = document.createElement("canvas");
      sCanvas.width = W;
      sCanvas.height = Math.ceil(srcH);
      const sctx = sCanvas.getContext("2d");
      if (sctx) {
        sctx.fillStyle = "#ffffff";
        sctx.fillRect(0, 0, sCanvas.width, sCanvas.height);
        sctx.drawImage(canvas, 0, srcY, W, srcH, 0, 0, W, srcH);
        doc.addImage(sCanvas.toDataURL("image/png", 0.92), "PNG", margin, margin, maxImgW, chunkHmm);
      }
      yMm += chunkHmm;
    }
  }

  const safe = (v.name || "volunteer").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
  doc.save(filename || `متطوع-${safe}.pdf`);
}

/**
 * @param {import('./types.js').Volunteer[]} list
 * @param {string} officeValue
 * @param {string} [filename]
 */
export function downloadOfficeExcel(list, officeValue, filename) {
  if (!window.XLSX) throw new Error("مكتبة SheetJS غير محمّلة.");
  const all = !officeValue || officeValue === "all";
  const filtered = all
    ? [...list]
    : list.filter((v) => v.office && sameOffice(v.office, officeValue));

  const header = [
    "الاسم",
    "البريد",
    "الهاتف",
    "الجنس",
    "تاريخ الميلاد",
    "مكان الإقامة",
    "زمرة الدم",
    "المكتب",
    "الوضع",
    "الجامعة",
    "الاختصاص",
    "السنة الدراسية",
    "تاريخ التخرج",
  ];
  const rows = filtered.map((v) => [
    v.name,
    v.email,
    v.phone,
    v.gender,
    v.birthDate,
    v.location,
    v.bloodType,
    v.office,
    v.status ? STATUS_AR[v.status] || v.status : "",
    v.university,
    v.major,
    v.studyYear,
    v.graduationDate,
  ]);
  const ws = window.XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "متطوعون");
  const label = all ? "الكل" : officeValue;
  const officeSafe = String(label).replace(/[\\/*?:\[\]]/g, "_");
  const fn = filename || `متطوعون-${officeSafe}.xlsx`;
  window.XLSX.writeFile(wb, fn);
}
