const fs = require("node:fs");
const path = require("node:path");
const { classify } = require("./web/engine.js");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function csvObjects(text) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const headers = rows.shift();
  return rows
    .filter((row) => row.some((value) => value.trim() !== ""))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

const testPath = path.join(__dirname, "data", "시험_요구문항_40건.csv");
const tests = csvObjects(fs.readFileSync(testPath, "utf8"));
let firstCorrect = 0;
let topThreeCorrect = 0;
const wrong = [];

for (const test of tests) {
  const candidates = classify(test.요구내용);
  const departments = candidates.map((candidate) => candidate.과);
  if (departments[0] === test.정답_배분과) {
    firstCorrect += 1;
  }
  if (departments.includes(test.정답_배분과)) {
    topThreeCorrect += 1;
  }
  if (departments[0] !== test.정답_배분과) {
    wrong.push({
      시험번호: test.시험번호,
      요구내용: test.요구내용,
      정답: test.정답_배분과,
      "엔진 결과": departments.join(" > ") || "후보 없음",
    });
  }
}

console.log(`1순위 정답 ${firstCorrect}/${tests.length} · 3순위 안 ${topThreeCorrect}/${tests.length}`);
console.log("\n틀린 문항");
if (wrong.length === 0) {
  console.log("없음");
} else {
  console.table(wrong);
}
