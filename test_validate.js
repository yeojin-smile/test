"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Papa = require("./web/lib/papaparse.min.js");
const Validate = require("./web/validate.js");
const Flow = require("./web/flow.js");
const org = require("./api/org.json");

function makeReplyRows() {
  return [
    ["요구: 최근 5년간 사업 실적"],
    ["연도", "예산(천원)", "집행액(천원)", "비고"],
    ["2022", "100", "80", ""],
    ["2023", "100", "90", ""],
    ["2025", "100", "120", ""],
    ["2026", "100", "90", ""],
    ["합계", "400", "370", "", ""]
  ];
}

function registerRow(overrides = {}) {
  return {
    접수번호: "R-100",
    접수일: "2026-02-10",
    요구기간_시작: "2022",
    요구기간_끝: "2026",
    제출기한: "2026-02-15",
    문항번호: "1",
    배분과: org.과[0],
    위원회: "교육위원회",
    ...overrides
  };
}

function testReplyValidation() {
  const source = makeReplyRows();
  const original = structuredClone(source);
  const issues = Validate.validateReply(source, "최근 5년간 사업 실적", { currentYear: 2026 });
  assert(issues.some(issue => issue.includes("연도 누락: 2024")));
  assert(issues.some(issue => issue.includes("집행액이 예산을 초과")));
  assert(issues.some(issue => issue.includes("합계 행 불일치")));
  assert.deepEqual(source, original, "검사는 원본 회신 행을 바꾸지 않아야 함");

  const clean = [
    ["요구: 최근 3년간 현황"],
    ["연도", "예산", "집행액", "비고"],
    ["2024", "100", "80", ""],
    ["2025", "100", "90", ""],
    ["2026", "100", "95", ""],
    ["합계", "300", "265", "", ""]
  ];
  assert.deepEqual(Validate.validateReply(clean, "최근 3년간 현황", { currentYear: 2026 }), []);

  const malformed = Validate.validateReply([[""], []], "최근 3년간 현황", { currentYear: 2026 });
  assert(malformed.some(issue => issue.includes("1행 요구 표시")));
  assert(malformed.some(issue => issue.includes("2행 머리글")));
  return { 확인필요: issues, 정상자료: "통과", "행·머리글": "통과" };
}

function testRegisterValidation() {
  const rows = [
    registerRow(),
    registerRow({
      접수번호: "R-100",
      위원회: " 교육위원회 ",
      요구기간_시작: "2026",
      요구기간_끝: "2024",
      제출기한: "2026-02-01",
      배분과: "조직도밖가짜과"
    }),
    registerRow({
      접수번호: "R-101",
      문항번호: "2",
      제출기한: "2026/02/20"
    })
  ];
  const original = structuredClone(rows);
  const issues = Validate.validateRegister(rows, org.과);
  const categories = new Set(issues.map(issue => issue.항목));
  for (const expected of ["배분과", "요구기간", "제출기한", "중복 접수", "위원회"]) {
    assert(categories.has(expected), expected + " 점검 결과가 있어야 함");
  }
  assert(issues.some(issue => issue.내용.includes("제출기한이 접수일보다 빠릅니다.")));
  assert(issues.some(issue => issue.내용.includes("YYYY-MM-DD")));
  assert(issues.some(issue => issue.내용.includes("공백")));
  assert.deepEqual(rows, original, "CSV 검사는 원본 행을 바꾸지 않아야 함");
  return { 확인필요: issues.length, 점검항목: [...categories], 원본변경: false };
}

function testReferenceCsv() {
  const source = fs.readFileSync("./data/검증용_접수대장_120건.csv", "utf8");
  const rows = Papa.parse(source, { header: true, skipEmptyLines: "greedy", transformHeader: value => value.trim() }).data;
  const original = structuredClone(rows);
  const issues = Validate.validateRegister(rows, org.과);
  assert.equal(rows.length, 120);
  assert.deepEqual(rows, original, "검증용 접수대장 원본 행을 바꾸지 않아야 함");
  return { 자료건수: rows.length, 확인필요: issues.length, 원본변경: false };
}

function testFlowActions() {
  const lead = org.과[0];
  const helper = org.과[1];
  const outsider = org.과[2];
  const base = {
    cases: [{
      id: "test-1", 상태: "회신완료", 주관과: lead, 협조과: [helper],
      "과별 회신": { [lead]: { 파일명: "lead.xlsx" }, [helper]: { 파일명: "helper.xlsx" } },
      보완: null, "확정 코멘트": ""
    }],
    log: []
  };
  const ask = (request) => Flow.apply(structuredClone(base), { id: "test-1", 작업: "보완요청", ...request }, org);
  assert.throws(() => ask({ 과: lead, 사유: "" }), error => error.status === 400);
  assert.throws(() => ask({ 과: outsider, 사유: "확인" }), error => error.status === 403);
  assert.throws(() => ask({ 과: "없는과", 사유: "확인" }), error => error.status === 400);
  assert.throws(() => Flow.apply({ cases: [{ id: "test-1", 상태: "접수" }], log: [] }, { 작업: "보완요청", id: "test-1", 과: lead, 사유: "확인" }, org), error => error.status === 409);

  const requested = ask({ 과: helper, 사유: "집행 근거자료 보완" });
  assert.equal(requested.result.상태, "보완요청");
  assert.deepEqual(requested.db.cases[0].보완.과, [helper]);
  const resubmitted = Flow.apply(requested.db, {
    작업: "회신", id: "test-1", 과: helper, 파일명: "helper-revised.xlsx", 행: []
  }, org);
  assert.equal(resubmitted.result.상태, "회신완료");
  assert.equal(resubmitted.db.cases[0].보완, null);
  assert.throws(() => Flow.apply(resubmitted.db, { 작업: "확정", id: "test-1", 코멘트: "" }, org), error => error.status === 400);
  const confirmed = Flow.apply(resubmitted.db, { 작업: "확정", id: "test-1", 코멘트: "담당자 확인 완료" }, org);
  assert.equal(confirmed.db.cases[0].상태, "확정");
  assert.equal(confirmed.db.cases[0]["확정 코멘트"], "담당자 확인 완료");
  return { 보완대상제한: "통과", 재회신후완료: "통과", 확정코멘트필수: "통과", 최종상태: confirmed.db.cases[0].상태 };
}

console.log(JSON.stringify({
  통과: true,
  회신엑셀: testReplyValidation(),
  접수대장: testRegisterValidation(),
  검증용접수대장: testReferenceCsv(),
  상태흐름: testFlowActions()
}, null, 2));
