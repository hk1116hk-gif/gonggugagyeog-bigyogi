import type { ParsedProduct, ProductResult, SimilarRow, SourceItem, Verdict } from './types';
import { calcUnitPrice, median, unitLabelFor } from './types';

export interface VerdictInput {
  product: ParsedProduct;
  /** DB에 쌓인 동일 상품 과거 공구가 (이번 분석 이전 것만). */
  pastGroupUnitPrices: number[];
  /** 현재 정가 단위가격. */
  regularUnitPrice: number | null;
  /** 비슷한 모델 오퍼 (단위가격 포함). */
  similar: SourceItem[];
}

/**
 * 판정 로직 (아티팩트와 동일):
 * - 자체 과거 공구가 있으면 그 중앙값/최저가가 1순위 기준.
 * - 없으면 비슷한 모델 중앙값이 주 근거.
 * - 정가보다 비싸면 비싸요, 비슷한 모델보다 훨씬 비싸면 대체 구매 경고.
 */
export function judge(input: VerdictInput): ProductResult {
  const { product, pastGroupUnitPrices, regularUnitPrice, similar } = input;
  const shippingFree =
    product.shipping === 0 ||
    (product.freeShippingThreshold != null && product.price >= product.freeShippingThreshold);
  const effectivePrice = product.price + (shippingFree ? 0 : product.shipping);
  const unitPrice = calcUnitPrice(product, effectivePrice);

  const similarUnits = similar.map((s) => s.unitPrice).filter((n): n is number => n != null);
  const similarMedian = median(similarUnits);
  const similarMin = similarUnits.length ? Math.min(...similarUnits) : null;
  const pastMedian = median(pastGroupUnitPrices);
  const pastMin = pastGroupUnitPrices.length ? Math.min(...pastGroupUnitPrices) : null;

  const warnings: string[] = [];
  if (!shippingFree && product.freeShippingThreshold != null) {
    warnings.push(`무료배송 ${product.freeShippingThreshold.toLocaleString('ko-KR')}원 미충족 — 배송비 ${product.shipping.toLocaleString('ko-KR')}원이 더해졌어요`);
  }

  let verdict: Verdict = 'unknown';
  let basis: ProductResult['verdictBasis'] = 'none';

  // 기준가: 과거 공구 중앙값이 있으면 1순위, 없으면 비슷한 모델 중앙값.
  const basisPrice = pastMedian ?? similarMedian;
  if (basisPrice != null) {
    basis = pastMedian != null ? 'past_group' : 'similar';
    const ratio = unitPrice / basisPrice;
    if (ratio <= 0.95) verdict = 'cheap';
    else if (ratio <= 1.05) verdict = 'fair';
    else verdict = 'expensive';
  } else if (regularUnitPrice != null) {
    basis = 'regular';
    verdict = unitPrice < regularUnitPrice ? 'cheap' : unitPrice <= regularUnitPrice * 1.05 ? 'fair' : 'expensive';
  }

  if (regularUnitPrice != null && unitPrice > regularUnitPrice) {
    warnings.push('공구가가 정가보다 비싸요');
    if (verdict === 'cheap') verdict = 'fair';
  }
  const cheapestSimilar = similarUnits.length
    ? similar.reduce((a, b) => (a.unitPrice ?? Infinity) < (b.unitPrice ?? Infinity) ? a : b)
    : null;
  if (similarMedian != null && unitPrice > similarMedian * 1.3) {
    warnings.push(`비슷한 모델보다 많이 비싸요 — 가장 싼 비슷한 모델 ${cheapestSimilar?.title ?? ''}`);
  }

  // 순위표: 이 공구 + 비슷한 모델을 싼 순으로 정렬.
  const displayName = product.name.startsWith(product.brand) ? product.name : `${product.brand} ${product.name}`;
  const rows: SimilarRow[] = [
    { name: `${displayName} (이 공구)`, unitPrice, price: effectivePrice, isThis: true },
    ...similar.map((s) => ({
      name: s.title,
      unitPrice: s.unitPrice ?? 0,
      price: s.price ?? 0,
      url: s.url,
      isThis: false,
      rating: s.rating ?? null,
    })),
  ]
    .filter((r) => r.unitPrice > 0)
    .sort((a, b) => a.unitPrice - b.unitPrice);
  const rank = rows.findIndex((r) => r.isThis) + 1 || null;

  return {
    brand: product.brand,
    name: product.name,
    spec: product.spec,
    category: product.category,
    unitLabel: unitLabelFor(product.category),
    price: product.price,
    shipping: shippingFree ? 0 : product.shipping,
    effectivePrice,
    unitPrice,
    verdict,
    verdictBasis: basis,
    pastGroupPrice: pastMin,
    pastGroupCount: pastGroupUnitPrices.length,
    regularUnitPrice,
    similarMedian,
    similarMin,
    similarCount: similar.length,
    cheapestSimilarName: cheapestSimilar?.title ?? null,
    rank,
    totalInRank: rows.length,
    similarRows: rows,
    warnings,
    sources: similar,
  };
}
