import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
NODE_SCRIPT = r"""
const LogView = require("./web/log.js");
const XLSX = require("./web/lib/xlsx.full.min.js");
const cases = [
  { id: "C-101", 상태: "회신완료" },
  { id: "C-102", 상태: "확정" },
  { id: "K-009", 상태: "접수" }
];
const logs = [
  { 일시: "2026-11-11T00:00:00.000Z", 작업: "접수", 문항: "C-101", 과: "산업정책과" },
  { 일시: "2026-11-11T01:00:00.000Z", 작업: "배분", 문항: "C-101", 과: "산업정책과" },
  { 일시: "2026-11-11T02:00:00.000Z", 작업: "회신", 문항: "C-102", 과: "디지털정책과" },
  { 일시: "2026-11-11T03:00:00.000Z", 작업: "배분", 문항: "K-009", 과: "산업정책과" }
];
const departmentEntries = LogView.filterEntries(logs, cases, { 과: "산업정책과" });
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.aoa_to_sheet(LogView.worksheetRows(departmentEntries)),
  "처리 기록"
);
const binary = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
const reopened = XLSX.read(binary, { type: "buffer" });
const exportedRows = XLSX.utils.sheet_to_json(reopened.Sheets["처리 기록"], { header: 1, defval: "" });
const prefixEntries = LogView.filterEntries(logs, cases, { 문항: "C-101" });
console.log(JSON.stringify({
  departmentCount: departmentEntries.length,
  excelHeaders: exportedRows[0],
  excelRowCount: exportedRows.length - 1,
  excelDepartments: exportedRows.slice(1).map(row => row[3]),
  excelStatuses: exportedRows.slice(1).map(row => row[4]),
  prefixCount: prefixEntries.length,
  prefixItems: [...new Set(prefixEntries.map(entry => entry.문항))],
  formattedTime: departmentEntries[0] && LogView.formatKoreanTime(departmentEntries[0].일시)
}));
"""
REMINDER_SCRIPT = r"""
const Reminders = require("./web/reminders.js");
const XLSX = require("./web/lib/xlsx.full.min.js");
const cases = [
  {
    id: "C-101", 문항번호: "1", 요구내용: "사업 추진 실적", 제출기한: "2026-11-12", 상태: "배분확정",
    주관과: "산업정책과", 협조과: ["디지털정책과"], "과별 회신": { "산업정책과": { 파일명: "회신.xlsx" } }
  },
  {
    id: "C-102", 문항번호: "2", 요구내용: "예산 집행 현황", 제출기한: "2026.11.09", 상태: "회신중",
    주관과: "산업정책과", 협조과: [], "과별 회신": {}
  },
  {
    id: "C-103", 문항번호: "3", 요구내용: "이미 모두 회신", 제출기한: "2026-11-12", 상태: "회신중",
    주관과: "산업정책과", 협조과: ["디지털정책과"],
    "과별 회신": { "산업정책과": { 파일명: "a.xlsx" }, "디지털정책과": { 파일명: "b.xlsx" } }
  },
  {
    id: "C-104", 문항번호: "4", 요구내용: "기한 확인 필요", 제출기한: "기한 미상", 상태: "보완요청",
    주관과: "운영지원과", 협조과: [], "과별 회신": { "운영지원과": { 파일명: "이전회신.xlsx" } },
    보완: { 과: ["운영지원과"], 사유: "자료 보완" }
  },
  {
    id: "C-105", 문항번호: "5", 요구내용: "이미 확정", 제출기한: "2026-11-10", 상태: "확정",
    주관과: "산업정책과", 협조과: [], "과별 회신": {}
  }
];
const result = Reminders.buildReminderRows(cases, { referenceDate: "2026-11-11", maxDays: 2 });
const workbook = XLSX.utils.book_new();
const targetHeaders = ["과", "구분", "제출기한", "문항", "요구내용", "상태"];
const reviewHeaders = ["과", "제출기한", "문항", "요구내용", "상태", "확인필요"];
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([targetHeaders, ...result.targets.map(row => targetHeaders.map(key => row[key] || ""))]), "독촉목록");
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([reviewHeaders, ...result.needsReview.map(row => reviewHeaders.map(key => row[key] || ""))]), "확인필요");
const reopened = XLSX.read(XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }), { type: "buffer" });
const targetRows = XLSX.utils.sheet_to_json(reopened.Sheets["독촉목록"], { header: 1, defval: "" });
const reviewRows = XLSX.utils.sheet_to_json(reopened.Sheets["확인필요"], { header: 1, defval: "" });
const zero = Reminders.buildReminderRows([cases[2]], { referenceDate: "2026-11-11", maxDays: 2 });
const notice = Reminders.buildNoticeText(result.targets, "국회 총괄 담당자");
console.log(JSON.stringify({
  targets: result.targets,
  review: result.needsReview,
  zeroTargetCount: zero.targets.length,
  sheetNames: reopened.SheetNames,
  excelTargetRows: targetRows.length - 1,
  excelTargetHeaders: targetRows[0],
  excelReviewRows: reviewRows.length - 1,
  notice
}));
"""


class ProcessingLogWebTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        completed = subprocess.run(
            ["node", "-e", NODE_SCRIPT],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        cls.result = json.loads(completed.stdout)
        reminders = subprocess.run(
            ["node", "-e", REMINDER_SCRIPT],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        cls.reminders = json.loads(reminders.stdout)

    def test_department_filter_and_excel_rows_match(self):
        self.assertEqual(self.result["departmentCount"], 3)
        self.assertEqual(self.result["excelRowCount"], self.result["departmentCount"])
        self.assertEqual(
            self.result["excelHeaders"],
            ["일시", "작업", "문항", "과", "지금상태"],
        )
        self.assertEqual(self.result["excelDepartments"], ["산업정책과"] * 3)
        self.assertEqual(self.result["excelStatuses"], ["회신완료", "회신완료", "접수"])

    def test_question_filter_matches_prefix(self):
        self.assertEqual(self.result["prefixCount"], 2)
        self.assertEqual(self.result["prefixItems"], ["C-101"])

    def test_utc_time_is_shown_in_korea_time(self):
        self.assertEqual(self.result["formattedTime"], "2026-11-11 09:00:00")

    def test_deadline_labels_and_only_pending_departments(self):
        rows = self.reminders["targets"]
        self.assertEqual([(row["과"], row["구분"]) for row in rows], [
            ("디지털정책과", "D-1"),
            ("산업정책과", "기한 경과"),
        ])
        self.assertNotIn("산업정책과", [row["과"] for row in rows if row["문항"] == "1"])
        self.assertEqual(self.reminders["zeroTargetCount"], 0)

    def test_unreadable_deadline_is_separate_for_review(self):
        review = self.reminders["review"]
        self.assertEqual(len(review), 1)
        self.assertEqual(review[0]["과"], "운영지원과")
        self.assertIn("날짜로 읽을 수 없습니다", review[0]["확인필요"])

    def test_excel_contains_reminder_and_review_sheets(self):
        self.assertEqual(self.reminders["sheetNames"], ["독촉목록", "확인필요"])
        self.assertEqual(self.reminders["excelTargetRows"], len(self.reminders["targets"]))
        self.assertEqual(self.reminders["excelReviewRows"], len(self.reminders["review"]))
        self.assertEqual(self.reminders["excelTargetHeaders"], ["과", "구분", "제출기한", "문항", "요구내용", "상태"])

    def test_department_notice_includes_recipient_count_and_sender(self):
        notice = self.reminders["notice"]
        self.assertIn("수신: 디지털정책과", notice)
        self.assertIn("제목: 국회 요구자료 제출기한 안내", notice)
        self.assertIn("건수: 1건", notice)
        self.assertIn("발신: 국회 총괄 담당자", notice)
        self.assertIn("문항 1", notice)


if __name__ == "__main__":
    unittest.main(verbosity=2)
