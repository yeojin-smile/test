(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LogView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const HEADERS = ["일시", "작업", "문항", "과", "지금상태"];

  function formatKoreanTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return fields.year + "-" + fields.month + "-" + fields.day + " " + fields.hour + ":" + fields.minute + ":" + fields.second;
  }

  function filterEntries(logs, cases, filters = {}) {
    const caseMap = new Map((Array.isArray(cases) ? cases : []).map((item) => [String(item.id || ""), item]));
    return (Array.isArray(logs) ? logs : [])
      .map((entry) => {
        const caseId = String(entry && entry.문항 || "");
        const item = caseMap.get(caseId);
        return {
          일시: entry && entry.일시 || "",
          작업: entry && entry.작업 || "",
          문항: caseId,
          과: entry && entry.과 || "",
          지금상태: item && item.상태 || ""
        };
      })
      .filter((entry) => !filters.작업 || entry.작업 === filters.작업)
      .filter((entry) => !filters.과 || entry.과 === filters.과)
      .filter((entry) => !filters.문항 || entry.문항.startsWith(filters.문항));
  }

  function worksheetRows(entries) {
    return [HEADERS, ...(entries || []).map((entry) => [
      formatKoreanTime(entry.일시),
      entry.작업 || "",
      entry.문항 || "",
      entry.과 || "",
      entry.지금상태 || ""
    ])];
  }

  return { HEADERS, formatKoreanTime, filterEntries, worksheetRows };
});
