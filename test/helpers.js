// 테스트 파일들이 공유하는 아주 작은 실행기 (외부 테스트 프레임워크 없이 assert만 사용)
const assert = require('assert');

let passed = 0;
let failed = 0;

// fn이 동기 함수면 그 자리에서 바로 결과를 반영하고, Promise를 반환하면
// (호출부가 await해야) 완료 후 반영한다 — 동기 테스트를 await 없이 순서대로
// 호출해도 summary()가 먼저 찍히는 일이 없도록 한다.
function test(name, fn) {
  const onOk = () => {
    passed++;
    console.log(`  ok - ${name}`);
  };
  const onErr = (err) => {
    failed++;
    console.log(`  FAIL - ${name}`);
    console.log(`    ${err.message}`);
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(onOk, onErr);
    }
    onOk();
  } catch (err) {
    onErr(err);
  }
}

function summary(fileLabel) {
  console.log(`${fileLabel}: ${passed}개 통과, ${failed}개 실패`);
  if (failed > 0) process.exitCode = 1;
}

module.exports = { test, summary, assert };
