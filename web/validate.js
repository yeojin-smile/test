(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Validate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function cellText(value) {
    return value == null ? "" : String(value).trim();
  }

  function numberValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const text = cellText(value).replace(/,/g, "").replace(/[₩원\s]/g, "");
    if (!text || !/^-?\d+(?:\.\d+)?$/.test(text)) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function yearValue(value) {
    const match = cellText(value).match(/(?:19|20|21)\d{2}/);
    return match ? Number(match[0]) : null;
  }

  function validateReply(inputRows, requirement, options = {}) {
    const rows = Array.isArray(inputRows) ? inputRows : [];
    const issues = [];
    const first = Array.isArray(rows[0]) ? rows[0] : [];
    const headers = Array.isArray(rows[1]) ? rows[1].map(cellText) : [];
    const headerKeys = headers.map((value) => value.replace(/\s+/g, "").toLowerCase());
    const dataRows = rows.slice(2).filter((row) => Array.isArray(row) && row.some((value) => cellText(value) !== ""));

    if (!cellText(first[0]) || !/요구/.test(cellText(first[0]))) {
      issues.push("1행 요구 표시가 없습니다.");
    }
    if (!headers.length || !headers.some(Boolean)) {
      issues.push("2행 머리글을 찾을 수 없습니다.");
    }

    const context = cellText(requirement) + " " + first.map(cellText).join(" ");
    const recent = context.match(/최근\s*(\d+)\s*년/);
    const yearIndex = headerKeys.findIndex((value) => /^(연도|년도|해당연도)$/.test(value));
    if (recent) {
      const count = Number(recent[1]);
      if (yearIndex < 0) {
        issues.push("최근 연도 자료를 확인할 연도 열이 없습니다.");
      } else if (Number.isInteger(count) && count > 0 && count <= 100) {
        const currentYear = Number.isInteger(options.currentYear) ? options.currentYear : new Date().getFullYear();
        const expected = Array.from({ length: count }, (_, index) => currentYear - count + 1 + index);
        const submitted = new Set(dataRows.map((row) => yearValue(row[yearIndex])).filter(Boolean));
        const missing = expected.filter((year) => !submitted.has(year));
        if (missing.length) issues.push("연도 누락: " + missing.join(", "));
      }
    }

    const budgetIndex = headerKeys.findIndex((value) => value.includes("예산"));
    const spentIndex = headerKeys.findIndex((value) => value.includes("집행") && /(액|금액)/.test(value));
    const noteIndex = headerKeys.findIndex((value) => value.includes("비고") || value.includes("참고"));
    if (budgetIndex >= 0 && spentIndex >= 0) {
      dataRows.forEach((row) => {
        const budget = numberValue(row[budgetIndex]);
        const spent = numberValue(row[spentIndex]);
        if (budget != null && spent != null && spent > budget && (noteIndex < 0 || !cellText(row[noteIndex]))) {
          issues.push((yearValue(row[yearIndex]) || "해당") + "년 집행액이 예산을 초과했지만 비고가 없습니다.");
        }
      });
    }

    const isTotal = (row) => /합계|총계/.test(cellText(Array.isArray(row) ? row[0] : ""));
    const totalRows = rows.filter(isTotal);
    if (totalRows.length) {
      const dataOnly = rows.slice(2).filter((row) => Array.isArray(row) && row.some((value) => cellText(value) !== "") && !isTotal(row));
      const total = totalRows[0];
      headers.forEach((header, index) => {
        if (/연도|년도|기간|비고|참고/.test(headerKeys[index] || "")) return;
        const expected = dataOnly.reduce((sum, row) => sum + (numberValue(row[index]) ?? 0), 0);
        const actual = numberValue(total[index]);
        const hasNumbers = dataOnly.some((row) => numberValue(row[index]) != null);
        if (actual != null && hasNumbers && Math.abs(expected - actual) > 0.01) {
          issues.push("합계 행 불일치: " + (header || ("열 " + (index + 1))) + " 합계가 자료 행의 합과 다릅니다.");
        }
      });
    }

    return issues;
  }

  function parseDate(value) {
    const text = cellText(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const date = new Date(text + "T00:00:00Z");
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : date.getTime();
  }

  function periodValue(value) {
    const year = yearValue(value);
    if (year) return year;
    const date = parseDate(value);
    return date == null ? null : date;
  }

  function validateRegister(inputRows, departmentList) {
    const rows = Array.isArray(inputRows) ? inputRows : [];
    const departments = new Set((departmentList || []).map(cellText).filter(Boolean));
    const issues = [];
    const seen = new Map();
    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      if (!row || typeof row !== "object") return;
      for (const [field, value] of Object.entries(row)) {
        if (typeof value === "string" && value !== value.trim()) {
          issues.push({ 행: rowNumber, 항목: field, 내용: "앞뒤 공백이 있습니다." });
        }
      }

      const department = cellText(row.배분과);
      if (department && !departments.has(department)) {
        issues.push({ 행: rowNumber, 항목: "배분과", 내용: "조직도에 없는 과: " + department });
      }

      const start = periodValue(row.요구기간_시작);
      const end = periodValue(row.요구기간_끝);
      if (start != null && end != null && start > end) {
        issues.push({ 행: rowNumber, 항목: "요구기간", 내용: "요구기간 시작이 종료보다 늦습니다." });
      }

      const deadlineText = cellText(row.제출기한);
      const deadline = parseDate(deadlineText);
      if (!deadlineText || deadline == null) {
        issues.push({ 행: rowNumber, 항목: "제출기한", 내용: "제출기한 형식이 YYYY-MM-DD가 아닙니다." });
      } else {
        const received = parseDate(cellText(row.접수일));
        if (received != null && deadline < received) {
          issues.push({ 행: rowNumber, 항목: "제출기한", 내용: "제출기한이 접수일보다 빠릅니다." });
        }
      }

      const receiptNumber = cellText(row.접수번호);
      const questionNumber = cellText(row.문항번호);
      if (receiptNumber) {
        const key = receiptNumber + "::" + questionNumber;
        if (seen.has(key)) {
          issues.push({ 행: rowNumber, 항목: "중복 접수", 내용: "앞선 " + seen.get(key) + "행과 접수번호·문항번호가 같습니다." });
        } else {
          seen.set(key, rowNumber);
        }
      }
    });
    return issues;
  }

  return { validateReply, validateRegister, numberValue, yearValue };
});
