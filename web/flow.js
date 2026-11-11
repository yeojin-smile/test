(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Flow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CASE_FIELDS = [
    "id", "파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용",
    "세부항목", "비고", "상태", "주관과", "협조과", "확정방법", "후보",
    "과별 회신", "재배정", "보완", "확정 코멘트", "일시"
  ];
  const RECEIPT_FIELDS = [
    "id", "파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"
  ];
  const METHODS = new Set(["규칙", "AI", "수정"]);

  class FlowError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "FlowError";
      this.status = status;
    }
  }

  function fail(status, message) {
    throw new FlowError(status, message);
  }

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function copyAllowed(source, fields) {
    const result = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(source, field)) result[field] = source[field];
    }
    return result;
  }

  function normalizeDb(input) {
    if (Array.isArray(input)) return { cases: input, log: [] };
    if (!input || typeof input !== "object") return { cases: [], log: [] };
    return {
      cases: Array.isArray(input.cases) ? input.cases : [],
      log: Array.isArray(input.log) ? input.log : []
    };
  }

  function orgNames(org) {
    const rows = Array.isArray(org) ? org : (org && (org.과 || org.departments));
    if (!Array.isArray(rows)) fail(500, "조직도 형식이 올바르지 않음");
    return new Set(rows.map((row) => typeof row === "string" ? row : row && row.과).filter(Boolean));
  }

  function requireOrg(name, names, field) {
    const value = text(name);
    if (!value) fail(400, `${field} 필수`);
    if (!names.has(value)) fail(400, `${value}는 조직도에 없는 과`);
    return value;
  }

  function optionalOrgList(value, names, field) {
    if (value == null) return [];
    if (!Array.isArray(value)) fail(400, `${field}는 배열이어야 함`);
    const result = [];
    for (const item of value) {
      const name = requireOrg(item, names, field);
      if (!result.includes(name)) result.push(name);
    }
    return result;
  }

  function candidates(value, names) {
    if (value == null) return [];
    if (!Array.isArray(value)) fail(400, "후보는 배열이어야 함");
    return value.slice(0, 3).map((candidate) => {
      if (typeof candidate === "string") return requireOrg(candidate, names, "후보 과");
      if (!candidate || typeof candidate !== "object") fail(400, "후보 형식이 올바르지 않음");
      const normalized = { 과: requireOrg(candidate.과, names, "후보 과") };
      if (Number.isFinite(candidate.점수)) normalized.점수 = candidate.점수;
      if (Array.isArray(candidate.근거키워드)) normalized.근거키워드 = candidate.근거키워드.map(text).filter(Boolean);
      if (text(candidate.근거)) normalized.근거 = text(candidate.근거);
      return normalized;
    });
  }

  function findCase(db, id) {
    const cleanId = text(id);
    if (!cleanId) fail(400, "id 필수");
    const item = db.cases.find((row) => row && row.id === cleanId);
    if (!item) fail(400, `${cleanId} 문항을 찾을 수 없음`);
    return item;
  }

  function assigned(item) {
    return [item.주관과].concat(Array.isArray(item.협조과) ? item.협조과 : []).filter(Boolean);
  }

  function log(db, action, item, department, now) {
    const entry = { 일시: now, 작업: action, 문항: item.id };
    if (department) entry.과 = department;
    db.log.push(entry);
  }

  function apply(inputDb, request, org) {
    const db = normalizeDb(inputDb);
    const body = request && typeof request === "object" ? request : {};
    const action = text(body.작업);
    const names = orgNames(org);
    const now = new Date().toISOString();

    if (!action) fail(400, "작업 필수");

    if (action === "접수") {
      const id = text(body.id);
      if (!id) fail(400, "id 필수");
      if (db.cases.some((item) => item && item.id === id)) fail(409, `${id}는 이미 접수됨`);

      const item = copyAllowed(body, RECEIPT_FIELDS);
      item.id = id;
      item.상태 = "접수";
      item.주관과 = "";
      item.협조과 = [];
      item.확정방법 = "";
      item.후보 = candidates(body.후보, names);
      item["과별 회신"] = {};
      item.재배정 = null;
      item.보완 = null;
      item["확정 코멘트"] = "";
      item.일시 = now;
      db.cases.push(copyAllowed(item, CASE_FIELDS));
      log(db, action, item, "", now);
      return { db, result: { ok: true, id, 상태: item.상태 } };
    }

    const item = findCase(db, body.id);

    if (action === "배분") {
      if (!["접수", "재배정요청", "배분확정"].includes(item.상태)) {
        fail(409, `${item.상태} 상태에서는 배분할 수 없음`);
      }
      const lead = requireOrg(body.주관과, names, "주관과");
      const helpers = optionalOrgList(body.협조과, names, "협조과").filter((name) => name !== lead);
      const method = text(body.확정방법);
      if (!METHODS.has(method)) fail(400, "확정방법은 규칙, AI, 수정 중 하나여야 함");

      item.주관과 = lead;
      item.협조과 = helpers;
      item.확정방법 = method;
      item.후보 = candidates(body.후보, names);
      item["과별 회신"] = {};
      item.재배정 = null;
      item.상태 = "배분확정";
      item.일시 = now;
      log(db, action, item, lead, now);
      return { db, result: { ok: true, id: item.id, 상태: item.상태 } };
    }

    if (action === "보완요청") {
      if (!["회신중", "회신완료"].includes(item.상태)) {
        fail(409, item.상태 + " 상태에서는 보완을 요청할 수 없음");
      }
      const department = requireOrg(body.과, names, "과");
      if (!assigned(item).includes(department)) fail(403, department + "는 이 문항의 담당 과가 아님");
      if (!item["과별 회신"] || !item["과별 회신"][department]) {
        fail(409, department + "의 회신이 없어 보완을 요청할 수 없음");
      }
      const reason = text(body.사유);
      if (!reason) fail(400, "보완 사유 필수");
      item.보완 = { 과: [department], 사유: reason, 일시: now };
      item.상태 = "보완요청";
      item.일시 = now;
      log(db, action, item, department, now);
      return { db, result: { ok: true, id: item.id, 상태: item.상태, 과: department } };
    }

    if (action === "확정") {
      if (item.상태 !== "회신완료") fail(409, item.상태 + " 상태에서는 확정할 수 없음");
      const comment = text(body.코멘트 || body["확정 코멘트"]);
      if (!comment) fail(400, "확정 코멘트 필수");
      item["확정 코멘트"] = comment;
      item.상태 = "확정";
      item.일시 = now;
      log(db, action, item, "", now);
      return { db, result: { ok: true, id: item.id, 상태: item.상태 } };
    }

    if (action === "회신") {
      if (!["배분확정", "회신중", "보완요청"].includes(item.상태)) {
        fail(409, `${item.상태} 상태에서는 회신할 수 없음`);
      }
      const department = requireOrg(body.과, names, "과");
      const departments = assigned(item);
      if (!departments.includes(department)) fail(403, `${department}는 이 문항의 담당 과가 아님`);
      if (item.상태 === "보완요청") {
        const targets = item.보완 && Array.isArray(item.보완.과) ? item.보완.과 : [];
        if (!targets.includes(department)) fail(403, `${department}는 이 문항의 보완 대상 과가 아님`);
      }

      if (!item["과별 회신"] || typeof item["과별 회신"] !== "object") item["과별 회신"] = {};
      const reply = copyAllowed(body, ["파일명", "행", "메모", "확인필요"]);
      reply.일시 = now;
      item["과별 회신"][department] = reply;

      if (item.상태 === "보완요청" && item.보완) {
        item.보완.과 = item.보완.과.filter((name) => name !== department);
        if (item.보완.과.length === 0) item.보완 = null;
      }
      const allReplied = departments.every((name) => Boolean(item["과별 회신"][name]));
      item.상태 = allReplied && !item.보완 ? "회신완료" : "회신중";
      item.일시 = now;
      log(db, action, item, department, now);
      return { db, result: { ok: true, id: item.id, 상태: item.상태 } };
    }

    if (action === "재배정요청") {
      if (!["배분확정", "회신중", "보완요청"].includes(item.상태)) {
        fail(409, `${item.상태} 상태에서는 재배정을 요청할 수 없음`);
      }
      const department = requireOrg(body.과, names, "과");
      if (!assigned(item).includes(department)) fail(403, `${department}는 이 문항의 담당 과가 아님`);
      const reason = text(body.사유);
      if (!reason) fail(400, "재배정 사유 필수");
      const desired = body.희망과 == null || body.희망과 === ""
        ? ""
        : requireOrg(body.희망과, names, "희망과");
      item.재배정 = { 과: department, 사유: reason, 희망과: desired, 일시: now };
      item.상태 = "재배정요청";
      item.일시 = now;
      log(db, action, item, department, now);
      return { db, result: { ok: true, id: item.id, 상태: item.상태 } };
    }

    fail(400, `${action} 작업은 아직 지원하지 않음`);
  }

  return { apply, FlowError };
});
