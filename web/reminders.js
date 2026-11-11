(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Reminders = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TARGET_STATUSES = new Set(["배분확정", "회신중", "보완요청"]);

  function text(value) {
    return value == null ? "" : String(value).trim();
  }

  function parseDate(value) {
    const source = text(value);
    let match = source.match(/^(\d{4})\s*[-/.년]\s*(\d{1,2})\s*[-/.월]\s*(\d{1,2})\s*(?:일)?$/);
    if (!match && /^\d{8}$/.test(source)) {
      match = [source, source.slice(0, 4), source.slice(4, 6), source.slice(6, 8)];
    }
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const valueUtc = Date.UTC(year, month - 1, day);
    const date = new Date(valueUtc);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return Math.floor(valueUtc / 86400000);
  }

  function assigned(item) {
    return [...new Set([item && item.주관과]
      .concat(item && Array.isArray(item.협조과) ? item.협조과 : [])
      .map(text).filter(Boolean))];
  }

  function pendingDepartments(item) {
    const replies = item && item["과별 회신"] && typeof item["과별 회신"] === "object" ? item["과별 회신"] : {};
    const supplements = item && item.상태 === "보완요청" && item.보완 && Array.isArray(item.보완.과)
      ? new Set(item.보완.과.map(text))
      : new Set();
    return assigned(item).filter(department => !replies[department] || supplements.has(department));
  }

  function labelFor(days) {
    if (days < 0) return "기한 경과";
    if (days === 0) return "D-day";
    return "D-" + days;
  }

  function compareRows(a, b) {
    return a.과.localeCompare(b.과, "ko") || a._daysLeft - b._daysLeft || a.문항.localeCompare(b.문항, "ko");
  }

  function buildReminderRows(cases, options = {}) {
    const referenceDay = parseDate(options.referenceDate);
    if (referenceDay == null) throw new Error("기준일을 올바른 날짜로 입력하세요.");
    const maxDaysValue = Number(options.maxDays);
    const maxDays = Number.isInteger(maxDaysValue) && maxDaysValue >= 0 ? maxDaysValue : 2;
    const targets = [];
    const needsReview = [];

    (Array.isArray(cases) ? cases : []).forEach(item => {
      if (!item || !TARGET_STATUSES.has(item.상태)) return;
      const pending = pendingDepartments(item);
      if (!pending.length) return;
      const base = {
        제출기한: text(item.제출기한),
        문항: text(item.문항번호) || text(item.id),
        요구내용: text(item.요구내용),
        상태: text(item.상태)
      };
      const deadlineDay = parseDate(base.제출기한);
      if (deadlineDay == null) {
        pending.forEach(department => needsReview.push({
          과: department,
          ...base,
          확인필요: "제출기한을 날짜로 읽을 수 없습니다."
        }));
        return;
      }
      const daysLeft = deadlineDay - referenceDay;
      if (daysLeft > maxDays) return;
      pending.forEach(department => targets.push({
        과: department,
        구분: labelFor(daysLeft),
        ...base,
        _daysLeft: daysLeft
      }));
    });

    targets.sort(compareRows);
    needsReview.sort((a, b) => a.과.localeCompare(b.과, "ko") || a.문항.localeCompare(b.문항, "ko"));
    return {
      targets: targets.map(({ _daysLeft, ...row }) => row),
      needsReview
    };
  }

  function buildNoticeText(rows, sender) {
    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach(row => {
      if (!groups.has(row.과)) groups.set(row.과, []);
      groups.get(row.과).push(row);
    });
    if (!groups.size) return "독촉 대상이 없습니다.";
    const from = (text(sender).replace(/[\r\n]+/g, " ").trim()) || "국회 총괄 담당";
    return [...groups.entries()].map(([department, items]) => {
      const list = items.map((item, index) => {
        const content = text(item.요구내용).replace(/\s*\r?\n\s*/g, " ");
        return (index + 1) + ". " + item.구분 + " · 제출기한 " + item.제출기한 + " · 문항 " + item.문항 +
          (content ? "\n   " + content : "");
      }).join("\n");
      return [
        "수신: " + department,
        "제목: 국회 요구자료 제출기한 안내",
        "건수: " + items.length + "건",
        "목록:",
        list,
        "발신: " + from
      ].join("\n");
    }).join("\n\n------------------------------\n\n");
  }

  return { parseDate, pendingDepartments, buildReminderRows, buildNoticeText };
});
