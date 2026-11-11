"use strict";

const assert = require("node:assert/strict");
const { createHandler } = require("./api/app.js");
const org = require("./api/org.json");

function fakeStore(initial = { cases: [], log: [] }) {
  let value = structuredClone(initial);
  return {
    async read() { return structuredClone(value); },
    async write(next) { value = structuredClone(next); },
    value() { return structuredClone(value); }
  };
}

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = JSON.parse(body); }
  };
}

async function call(handler, method, body) {
  const res = response();
  await handler({ method, body }, res);
  return { status: res.statusCode, body: res.body };
}

function fakeOpenAI(output, inspect) {
  return async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const request = JSON.parse(options.body);
    if (inspect) inspect(request, options);
    return {
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(output) } }] };
      }
    };
  };
}

async function main() {
  const store = fakeStore();
  const handler = createHandler({ store, org });
  const results = [];

  results.push(await call(handler, "POST", {
    작업: "접수", id: "의원C-01", 의원: "의원C", 문항번호: "1",
    요구내용: "최근 3년간 디지털전환 사업 추진 실적",
    이름: "가상 이름", 연락처: "가상 연락처"
  }));
  results.push(await call(handler, "POST", {
    작업: "회신", id: "의원C-01", 과: "디지털정책과", 파일명: "회신.xlsx"
  }));
  results.push(await call(handler, "POST", {
    작업: "배분", id: "의원C-01", 주관과: "없는과", 협조과: [], 확정방법: "규칙"
  }));
  results.push(await call(handler, "POST", {
    작업: "배분", id: "의원C-01", 주관과: "디지털정책과",
    협조과: ["운영지원과"], 확정방법: "규칙"
  }));
  results.push(await call(handler, "POST", {
    작업: "회신", id: "의원C-01", 과: "안전정책과", 파일명: "회신.xlsx"
  }));
  results.push(await call(handler, "POST", {
    작업: "회신", id: "의원C-01", 과: "디지털정책과", 파일명: "주관.xlsx"
  }));
  results.push(await call(handler, "POST", {
    작업: "재배정요청", id: "의원C-01", 과: "운영지원과", 사유: ""
  }));
  results.push(await call(handler, "POST", {
    작업: "회신", id: "의원C-01", 과: "운영지원과", 파일명: "협조.xlsx"
  }));
  results.push(await call(handler, "GET"));

  assert.deepEqual(results.slice(0, 8).map((item) => item.status), [200, 409, 400, 200, 403, 200, 400, 200]);
  assert.equal(results[7].body.상태, "회신완료");
  assert.equal(results[8].body.cases[0].이름, undefined);
  assert.equal(results[8].body.cases[0].연락처, undefined);
  assert.equal(store.value().cases[0].상태, "회신완료");

  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "fake-test-key";
  const allowed = org.과.slice(0, 5);
  let requestChecked = false;
  const aiStore = fakeStore();
  const aiHandler = createHandler({
    store: aiStore,
    org,
    fetch: fakeOpenAI({
      후보: [
        { 과: allowed[0], 근거: "첫 번째 근거입니다. 불필요한 두 번째 문장입니다." },
        { 과: "조직도밖가짜과", 근거: "목록 밖 후보입니다." },
        { 과: allowed[1], 근거: "두 번째 근거입니다." },
        { 과: allowed[0], 근거: "중복 후보입니다." },
        { 과: allowed[2], 근거: "세 번째 근거입니다." },
        { 과: allowed[3], 근거: "네 번째 후보는 제한되어야 합니다." }
      ],
      해당없음: false
    }, (request, options) => {
      requestChecked = true;
      assert.equal(request.model, "gpt-4o-mini");
      assert.equal(request.temperature, 0);
      assert.deepEqual(request.response_format, { type: "json_object" });
      assert.equal(options.headers.Authorization, "Bearer fake-test-key");
      const content = request.messages.map(message => message.content).join("\\n");
      assert.match(content, /최근 3년간 디지털전환 사업/);
      assert.doesNotMatch(content, /가상 이름|가상 연락처/);
    })
  });
  const aiResult = await call(aiHandler, "POST", {
    작업: "AI추천", 요구내용: "최근 3년간 디지털전환 사업 추진 실적",
    이름: "가상 이름", 연락처: "가상 연락처"
  });
  assert.equal(aiResult.status, 200);
  assert.equal(requestChecked, true);
  assert.deepEqual(aiResult.body, {
    후보: [
      { 과: allowed[0], 근거: "첫 번째 근거입니다." },
      { 과: allowed[1], 근거: "두 번째 근거입니다." },
      { 과: allowed[2], 근거: "세 번째 근거입니다." }
    ],
    해당없음: false
  });
  assert.equal(aiStore.value().cases.length, 0, "AI추천은 cases.json을 변경하지 않아야 함");

  const emptyHandler = createHandler({
    store: fakeStore(), org,
    fetch: fakeOpenAI({ 후보: [], 해당없음: true })
  });
  const emptyResult = await call(emptyHandler, "POST", { 작업: "AI추천", 요구내용: "소관 과를 찾기 어려운 내용" });
  assert.equal(emptyResult.status, 200);
  assert.deepEqual(emptyResult.body, { 후보: [], 해당없음: true });

  const outsideHandler = createHandler({
    store: fakeStore(), org,
    fetch: fakeOpenAI({ 후보: [{ 과: "조직도밖가짜과", 근거: "목록 밖입니다." }], 해당없음: false })
  });
  const outsideResult = await call(outsideHandler, "POST", { 작업: "AI추천", 요구내용: "목록 밖 후보 제거 확인" });
  assert.equal(outsideResult.status, 200);
  assert.deepEqual(outsideResult.body, { 후보: [], 해당없음: true });

  delete process.env.OPENAI_API_KEY;
  const missingKeyHandler = createHandler({ store: fakeStore(), org, fetch: async () => { throw new Error("호출되면 안 됨"); } });
  const missingKeyResult = await call(missingKeyHandler, "POST", { 작업: "AI추천", 요구내용: "키 설정 확인" });
  assert.equal(missingKeyResult.status, 500);
  assert.match(missingKeyResult.body.error, /OPENAI_API_KEY/);
  if (previousKey !== undefined) process.env.OPENAI_API_KEY = previousKey;

  console.log(JSON.stringify({
    통과: true,
    상태코드: results.slice(0, 8).map((item) => item.status),
    최종상태: store.value().cases[0].상태,
    저장제외확인: { 이름: "없음", 연락처: "없음" },
    처리기록수: store.value().log.length,
    AI추천시험: {
      제한·필터·한문장: "통과",
      후보없음: "통과",
      조직도밖제거: "통과",
      키누락500: "통과",
      AI추천저장미변경: "통과"
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
