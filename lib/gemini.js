// Gemini API 호출: 후보 목록 중 사용자 요청에 맞는 최종 추천 선정 (출발지/이동시간 추출은 lib/recommend.js에서 로컬로 처리)
const { toPromptCandidates, parsePicksResponse } = require('./recommend');

const DEFAULT_MODEL = 'gemini-2.5-flash';

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }),
  });
  if (res.status === 429) {
    const err = new Error('죄송합니다. 토큰 사용량이 한도초과 되었으니 잠시 쉬셨다가 다시 시도해 주세요!');
    err.quotaExceeded = true;
    throw err;
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API 호출 실패 (${res.status}) ${errText}`.trim());
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini 응답이 비어 있습니다.');
  return text;
}

async function pickRecommendations(query, candidates) {
  if (!candidates.length) return [];

  const prompt = `당신은 TV 프로그램 "식객 허영만의 백반기행"에 소개된 식당 중에서 사용자에게 딱 맞는 곳을 추천하는 도우미입니다.
아래 후보 식당 목록(JSON)에서 사용자 요청에 가장 잘 맞는 곳을 2~3곳 선정하고, 각각 왜 추천하는지 한국어로 1~2문장씩 이유를 작성해 JSON 배열로만 응답하세요.

사용자 요청: "${query}"

후보 목록:
${JSON.stringify(toPromptCandidates(candidates))}

응답 형식(JSON 배열만, 다른 텍스트 없이):
[{"episode": 123, "name": "후보 목록에 있는 식당명 그대로", "reason": "추천 이유"}]

규칙:
- episode와 name은 반드시 위 후보 목록에 있는 값과 정확히 일치해야 합니다. 목록에 없는 식당을 지어내지 마세요.
- 사용자 요청과 어울리는 후보가 전혀 없으면 빈 배열 []을 반환하세요.`;

  const text = await callGemini(prompt);
  return parsePicksResponse(text, candidates);
}

module.exports = { pickRecommendations };
