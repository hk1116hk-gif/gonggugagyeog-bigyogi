import OpenAI from 'openai';
import type { ParsedProduct } from './types';

let client: OpenAI | null = null;

/**
 * 무료로 쓰기: OPENAI_API_KEY 자리에 무료 키를 넣고, OPENAI_BASE_URL로 무료 제공자를 가리키면 된다.
 * - Google Gemini 무료: https://aistudio.google.com 에서 키 발급 → OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/ , OPENAI_MODEL=gemini-2.0-flash
 * - Groq 무료: https://console.groq.com 에서 키 발급 → OPENAI_BASE_URL=https://api.groq.com/openai/v1 , OPENAI_MODEL=llama-3.3-70b-versatile (이미지 전사는 미지원이라 텍스트 분석만 됨)
 * 아무것도 안 넣으면 OpenAI 기본 엔드포인트를 쓴다.
 */
export function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
  }
  return client;
}

export function requireOpenAI(): OpenAI {
  const c = getOpenAI();
  if (!c) {
    const err = new Error('OPENAI_API_KEY가 설정되지 않았어요. .env.local에 OPENAI_API_KEY를 넣어 주세요.') as Error & { code?: string };
    err.code = 'missing_key';
    throw err;
  }
  return c;
}

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/** 60초 제한 — 아티팩트에서 90초짜리 거대 호출이 타임아웃으로 죽은 교훈. */
async function chat<T>(messages: OpenAI.ChatCompletionMessageParam[], json: boolean): Promise<T> {
  const c = requireOpenAI();
  const res = await c.chat.completions.create({
    model: MODEL,
    messages,
    response_format: json ? { type: 'json_object' } : undefined,
    temperature: 0,
    max_tokens: 4000,
  });
  const text = res.choices[0]?.message?.content ?? '';
  if (json) {
    // Gemini가 가끔 ```json 펜스로 감싸서 준다 — 벗겨내고 파싱한다.
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned) as T;
  }
  return text as unknown as T;
}

export interface ParseResponse {
  products: ParsedProduct[];
}

const PARSE_SYSTEM =
  '공구 게시글 일부에서 상품을 JSON으로 추출해. 응답은 {"products":[...]} 만. 각 상품: brand, name, spec(예 "100g"/"28cm"/"500ml"), specAmount(숫자), specUnit("g"|"ml"|"cm"|"piece"), quantity(팩/개 수, 없으면 1), price(공구 총액 원, 숫자만), shipping(배송비, 무료면 0), freeShippingThreshold(무료배송 기준액, 없으면 null), category("food"|"drink"|"household"|"other"). 식품은 food, 음료·액체는 drink, 후라이팬 등 생활용품은 household. 최종가(쿠폰 적용가)가 있으면 그걸 price로 써. 소비자가는 price로 쓰지 마. 정상가·최저가·특가가 함께 있으면 특가(공구가)를 price로 써. 상품명이 없는 조각(가격만 있는 줄)은 상품으로 만들지 마.';

/**
 * 공구 게시글 본문을 상품 목록으로 파싱한다.
 * 짧은 글은 한 번의 호출로 통째로 파싱한다 — 가격 줄마다 쪼개면
 * 정상가/최저가/특가가 따로 떨어져 이름 없는 상품이 생긴다 (이미지 전사본에서 확인됨).
 * 긴 글만 상품 단위 블록으로 나눠 병렬로 돌린다.
 */
export async function parsePostWithLLM(postText: string): Promise<ParsedProduct[]> {
  if (postText.length <= 4000) {
    try {
      const out = await chat<ParseResponse>(
        [
          { role: 'system', content: PARSE_SYSTEM },
          { role: 'user', content: postText },
        ],
        true,
      );
      return (out.products ?? []).filter((p) => p.name && p.name.trim() && p.price > 0).slice(0, 6);
    } catch {
      return [];
    }
  }

  // 긴 글: 빈 줄·구분선(---)·번호 항목으로 상품 블록을 나눈다.
  const blocks = postText
    .split(/\n\s*(?:---|\d+\.\s)\s*\n|\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  const chunks = blocks.length ? blocks.slice(0, 6) : [postText];

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const out = await chat<ParseResponse>(
          [
            { role: 'system', content: PARSE_SYSTEM },
            { role: 'user', content: chunk },
          ],
          true,
        );
        return (out.products ?? []).filter((p) => p.name && p.name.trim() && p.price > 0);
      } catch {
        return [] as ParsedProduct[];
      }
    }),
  );
  const merged = results.flat().slice(0, 6);
  return merged;
}

/** 이미지(data URL)를 서버 비전으로 전사한다. */
export async function transcribeImageWithVision(imageDataUrl: string): Promise<string> {
  const c = requireOpenAI();
  const res = await c.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '이 공구 게시글 이미지의 글자를 그대로 전사해. 상품명, 가격, 배송비, 무료배송 조건을 빠짐없이 적어.' },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    max_tokens: 4000,
  });
  return res.choices[0]?.message?.content ?? '';
}
