import { NextResponse } from 'next/server';
import { getPrisma, safeDb } from '@/lib/db';
import { ERROR_MESSAGES, type ErrorCode, type ProductResult, type SourceItem } from '@/lib/types';
import { parsePostWithLLM, transcribeImageWithVision, getOpenAI } from '@/lib/llm';
import { parsePostWithRegex, productKey, sameForm, specWithin } from '@/lib/parse';
import { hitsToSources, searchProductRating, webSearch } from '@/lib/search';
import { judge } from '@/lib/verdict';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function fail(code: ErrorCode, status = 400, extra?: string) {
  const msg = ERROR_MESSAGES[code];
  return NextResponse.json(
    { ok: false, status: 'error', errorCode: code, message: extra ? `${msg.title} — ${extra}` : `${msg.title}. ${msg.body}` },
    { status },
  );
}

function isUrlOnly(text: string): string | null {
  const t = text.trim();
  if (/^https?:\/\/\S+$/.test(t)) return t;
  return null;
}

async function fetchReadableLink(url: string): Promise<string | null> {
  // 뽐뿌는 서버에서 403으로 막힌다 — 직접·모바일·프록시 모두 확인됨.
  if (/ppomppu\.co\.kr/.test(url)) return null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GongguPriceBot/1.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim();
    return text.length > 50 ? text : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json()) as { postText?: string; images?: string[] };
    let postText = (body.postText ?? '').trim();
    const images: string[] = Array.isArray(body.images) ? body.images.slice(0, 3) : [];

    // 링크만 입력된 경우
    const onlyUrl = isUrlOnly(postText);
    if (onlyUrl && !images.length) {
      const fetched = await fetchReadableLink(onlyUrl);
      if (!fetched) return fail('link_unreadable');
      postText = fetched;
    }

    // 이미지 전사 (서버 비전; 클라이언트 OCR이 이미 텍스트를 넣어줬으면 스킵)
    if (images.length) {
      if (!getOpenAI()) {
        // 키가 없으면 클라이언트 OCR 텍스트에 의존한다. 둘 다 없으면 이미지 오류.
        if (postText.length < 10) return fail('image_unreadable');
      } else {
        for (const img of images) {
          try {
            const text = await transcribeImageWithVision(img);
            if (text.trim()) postText += `\n${text}`;
          } catch {
            // 한 장 실패는 전체 실패가 아니다.
          }
        }
      }
    }

    if (postText.length < 10) return fail('no_products');

    // 파싱: LLM 1차, 실패하면 정규식 폴백.
    let products = [] as Awaited<ReturnType<typeof parsePostWithLLM>>;
    try {
      products = await parsePostWithLLM(postText);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'missing_key') {
        // OPENAI 키가 없으면 정규식 파서로 계속 간다 — 대신 출처/판정은 검색 기반으로.
        products = parsePostWithRegex(postText);
      } else {
        products = parsePostWithRegex(postText);
      }
    }
    if (!products.length) products = parsePostWithRegex(postText);
    if (!products.length) return fail('no_products');
    products = products.slice(0, 6);

    // 상품별 분석 — 블록별 병렬 소형 호출 (거대 단일 호출 금지).
    const results: ProductResult[] = [];
    const observations: Array<{ productKey: string; kind: string; price: number; unitPrice: number; source: string; url?: string }> = [];

    for (const product of products) {
      // 자기참조 방지: 이번 분석 이전에 저장된 가격만 과거 공구가로 쓴다.
      const past = await safeDb((db) =>
        db.priceObservation.findMany({
          where: { productKey: productKey(product), kind: 'past_group' },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      );
      const pastUnitPrices = (past ?? []).map((o) => o.unitPrice);

      // 4단계 탐색: 동일 상품 공구 / 동일 상품 정가 / 비슷한 모델 / 이 상품 후기 평점
      const [pastHits, regularHits, similarHits, rating] = await Promise.all([
        webSearch(`${product.brand} ${product.name} ${product.spec} 공구 가격`),
        webSearch(`${product.brand} ${product.name} ${product.spec} 가격`),
        webSearch(`${product.name} ${product.spec} 가격`.replace(product.brand, '').trim()),
        searchProductRating(product.brand, product.name),
      ]);
      const pastSources = hitsToSources(pastHits, 'past_group', product);
      const regularSources = hitsToSources(regularHits, 'regular', product);
      const similarRaw = hitsToSources(similarHits, 'similar', product).filter((s) => {
        if (s.title.includes(product.brand) && s.title.includes(product.name)) return false;
        if (!sameForm(product.name, s.title)) return false;
        return true;
      });
      // 비슷한 모델은 규격 ±35% 안인 것만 (단위가격이 있는 경우). 규격 정보가 없으면 제목만으로 포함.
      const similar = similarRaw.filter((s) => {
        const m = s.title.match(/(\d+(?:\.\d+)?)\s*(g|kg|ml|L|cm)/);
        if (!m) return true;
        const amt = Number(m[1]) * (m[2] === 'kg' || m[2] === 'L' ? 1000 : 1);
        const unit = m[2] === 'g' || m[2] === 'kg' ? 'g' : m[2] === 'ml' || m[2] === 'L' ? 'ml' : 'cm';
        return specWithin(product, amt, unit as never);
      });

      const regularUnit = regularSources.length
        ? Math.min(...regularSources.map((s) => s.unitPrice).filter((n): n is number => n != null))
        : null;

      const judged = judge({
        product,
        pastGroupUnitPrices: [...pastUnitPrices, ...pastSources.map((s) => s.unitPrice).filter((n): n is number => n != null)],
        regularUnitPrice: regularUnit,
        similar,
      });
      judged.sources = [...pastSources, ...regularSources, ...similar];
      judged.rating = rating?.rating ?? null;
      judged.reviewCount = rating?.reviewCount ?? null;
      judged.ratingSource = rating?.source ?? null;
      results.push(judged);

      for (const s of judged.sources) {
        if (s.price == null || s.unitPrice == null) continue;
        observations.push({
          productKey: productKey(product),
          kind: s.kind,
          price: s.price,
          unitPrice: s.unitPrice,
          source: s.source,
          url: s.url,
        });
      }
      // 이번 공구 자체 가격도 과거 공구로 누적 (다음 분석의 기준이 된다).
      observations.push({
        productKey: productKey(product),
        kind: 'past_group',
        price: judged.effectivePrice,
        unitPrice: judged.unitPrice,
        source: '이 공구',
      });

      if (Date.now() - startedAt > 240000) break; // 240초 넘기면 나머지는 판정보류로
    }

    // 저장
    const saved = await safeDb((db) =>
      db.analysis.create({
        data: {
          inputText: postText.slice(0, 12000),
          products: {
            create: results.map((r) => ({
              brand: r.brand,
              name: r.name,
              spec: r.spec,
              category: r.category,
              price: r.price,
              unitPrice: r.unitPrice,
              verdict: r.verdict,
              resultJson: JSON.stringify(r),
            })),
          },
          observations: { create: observations.map((o) => ({ ...o, url: o.url ?? null })) },
        },
        select: { id: true, createdAt: true },
      }),
    );

    return NextResponse.json({
      ok: true,
      status: 'ok',
      errorCode: null,
      id: saved?.id ?? null,
      createdAt: saved?.createdAt?.toISOString() ?? new Date().toISOString(),
      products: results,
      cheapCount: results.filter((r) => r.verdict === 'cheap').length,
    });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === 'missing_key') return fail('missing_key', 500, err.message);
    if (err.name === 'TimeoutError' || /timed out|timeout/i.test(err.message)) return fail('timeout', 504);
    console.error(e);
    return fail('server_error', 500);
  }
}

/** 오래 걸리는 분석이 끊겼을 때: 가장 최근 분석을 돌려준다 (복구 폴링용). */
export async function GET() {
  const latest = await safeDb((db) =>
    db.analysis.findFirst({ orderBy: { createdAt: 'desc' }, include: { products: true } }),
  );
  if (!latest) return NextResponse.json({ ok: false, status: 'error', errorCode: 'no_products', message: '저장된 분석이 없어요.' }, { status: 404 });
  return NextResponse.json({
    ok: true,
    status: 'ok',
    id: latest.id,
    createdAt: latest.createdAt.toISOString(),
    products: latest.products.map((p) => JSON.parse(p.resultJson) as ProductResult),
    cheapCount: latest.products.filter((p) => p.verdict === 'cheap').length,
  });
}

// PrismaClient를 직접 쓰지 않고 getPrisma를 경유하기 위한 import 유지
void getPrisma;
