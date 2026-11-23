import OpenAI from 'openai';
import type { ParsedProduct } from './types';

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
  if (json) return JSON.parse(text) as T;
  return text as unknown as T;
}

export interface ParseResponse {
  products: ParsedProduct[];
}

/**
 * 공구 게시글 본문을 상품 목록으로 파싱한다.
 * 한 번의 거대 호출이 아니라, 본문을 상품 후보 블록으로 나눠 작은 호출을 병렬로 돌린다.
 */
export async function parsePostWithLLM(postText: string): Promise<ParsedProduct[]> {
  // 1) 후보 블록 나누기: 줄 단위로 가격(원)이 있는 줄을 중심으로 묶는다.
  const lines = postText.split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks: string[] = [];
  let cur: string[] = [];
  for (const line of lines) {
    cur.push(line);
    if (/원/.test(line) && cur.length >= 2) {
      blocks.push(cur.join('\n'));
      cur = [];
    }
  }
  if (cur.length) blocks.push(cur.join('\n'));
  const chunks = blocks.length ? blocks.slice(0, 6) : [postText];

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const out = await chat<ParseResponse>(
          [
            {
              role: 'system',
              content:
                '공구 게시글 일부에서 상품을 JSON으로 추출해. 응답은 {"products":[...]} 만. 각 상품: brand, name, spec(예 "100g"/"28cm"/"500ml"), specAmount(숫자), specUnit("g"|"ml"|"cm"|"piece"), quantity(팩/개 수, 없으면 1), price(공구 총액 원, 숫자만), shipping(배송비, 무료면 0), freeShippingThreshold(무료배송 기준액, 없으면 null), category("food"|"drink"|"household"|"other"). 식품은 food, 음료·액체는 drink, 후라이팬 등 생활용품은 household. 최종가(쿠폰 적용가)가 있으면 그걸 price로 써. 소비자가는 price로 쓰지 마.',
            },
            { role: 'user', content: chunk },
          ],
          true,
        );
        return out.products ?? [];
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
