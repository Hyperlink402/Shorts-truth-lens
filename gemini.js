class GeminiVisionClient {
  async analyzeShorts({ videoId, title, channel, frames }) {
    return new Promise(async (resolve, reject) => {
      try {
        const settings = await new Promise((res) => {
          chrome.storage.sync.get(['mockMode', 'apiKey', 'geminiModel'], res);
        });

        const isMock = settings.mockMode !== false;
        const apiKey = settings.apiKey || '';
        const modelName = settings.geminiModel || 'gemini-1.5-flash';

        if (isMock) {
          setTimeout(() => {
            resolve(this._generateMockResult(videoId, title, channel));
          }, 1000);
          return;
        }

        if (!apiKey) {
          throw new Error('Gemini API 키가 설정되지 않았습니다. 확장 프로그램 설정 페이지에서 API 키를 입력해주세요.');
        }

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

        const imageParts = frames.map(base64Data => ({
          inline_data: {
            mime_type: "image/jpeg",
            data: base64Data
          }
        }));

        const promptText = `
당신은 유튜브 쇼츠 영상의 시각적 신뢰도와 AI 생성 여부를 판정하는 전문가입니다.
제공된 5개의 핵심 프레임(시작, 25%, 50%, 75%, 끝) 이미지와 영상 제목("${title}"), 채널명("${channel}")을 종합하여 분석해주세요.
최신 정보와 대조하여 영상의 신뢰성 여부를 검증해주세요.

반드시 아래 JSON 형식으로만 답변해주세요 (마크다운 백틱 없이 순수 JSON):
{
  "aiGenerationScore": 0부터 100 사이의 숫자 (AI 생성 비디오 가능성 점수),
  "aiSlopScore": "낮음", "보통", "높음 중 택1",
  "reliabilityVerdict": "신뢰할 만한 근거 확인", "허위 가능성 높음", "과장 또는 맥락 누락 의심", "근거 부족", "판단 불가 중 택1",
  "verdictReason": "시각적 프레임 분석 결과와 판정 근거를 2~3문장으로 요약"
}

단, 영상의 화질이 낮아 판별이 어려울 땐 다음과 같이 답하십시오.
{
  "aiGenerationScore": 0,
  "aiSlopScore": "모르겠음",
  "reliabilityVerdict": "판단 불가",
  "verdictReason": "N/A"
}

`;

        const requestBody = {
          contents: [
            {
              parts: [
                ...imageParts,
                { text: promptText }
              ]
            }
          ]
        };

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini API 오류 (${response.status}): ${errText}`);
        }

        const data = await response.json();
        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!textResponse) {
          throw new Error('Gemini API로부터 유효한 응답을 받지 못했습니다.');
        }

        const cleanedJson = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsedResult = JSON.parse(cleanedJson);
        
        resolve({
          videoId,
          title,
          channel,
          aiGenerationScore: parsedResult.aiGenerationScore ?? 50,
          aiSlopScore: parsedResult.aiSlopScore ?? '보통',
          reliabilityVerdict: parsedResult.reliabilityVerdict ?? '판단 불가',
          verdictReason: parsedResult.verdictReason ?? '프레임 분석 완료',
          analyzedAt: new Date().toLocaleTimeString('ko-KR'),
          isMock: false
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  _generateMockResult(videoId, title, channel) {
    const isLikelyAI = title.includes('AI') || title.includes('가상') || title.includes('생성') || title.includes('딥페이크');
    return {
      videoId,
      title,
      channel,
      aiGenerationScore: isLikelyAI ? 89 : 18,
      aiSlopScore: isLikelyAI ? '높음' : '낮음',
      reliabilityVerdict: isLikelyAI ? '과장 또는 맥락 누락 의심' : '신뢰할 만한 근거 확인',
      verdictReason: '캡처된 핵심 프레임과 영상 메타데이터를 시각적으로 분석한 Mock 시뮬레이션 결과입니다.',
      analyzedAt: new Date().toLocaleTimeString('ko-KR'),
      isMock: true
    };
  }
}

window.GeminiVisionClient = GeminiVisionClient;