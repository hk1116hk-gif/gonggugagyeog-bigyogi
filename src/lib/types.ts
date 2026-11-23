export type Verdict = 'cheap' | 'fair' | 'expensive' | 'unknown';
export type ErrorCode =
  | 'link_unreadable'
  | 'no_products'
  | 'parse_failed'
  | 'image_unreadable'
  | 'timeout'
  | 'server_error'
  | 'missing_key';

export const ERROR_MESSAGES: Record<ErrorCode, { title: string; body: string }> = {
  link_unreadable: {
    title: '링크 본문을 읽어오지 못했어요',
    body: '뽐뿌처럼 자동 읽기를 막는 사이트는 링크만으로는 분석할 수 없어요. 게시글 본문을 복사해서 붙여넣어 주세요.',
  },
  no_products: {
    title: '상품을 찾지 못했어요',
    body: '입력한 글에서 상품명과 가격을 찾지 못했어요. 상품명·가격이 보이는 본문이나 이미지를 넣어 주세요.',
  },
  parse_failed: {
    title: '게시글을 읽는 데 실패했어요',
    body: '게시글을 파싱하지 못했어요. 본문을 다시 복사해서 붙여넣어 주세요.',
  },
  image_unreadable: {
    title: '이미지를 읽지 못했어요',
    body: '이미지에서 글자를 읽지 못했어요. 더 선명하게 캡처하거나 본문 텍스트를 함께 넣어 주세요.',
  },
  timeout: {
    title: '시간 초과로 중단됐어요',
    body: '분석이 너무 오래 걸려 중단됐어요. 상품을 줄이거나 잠시 후 다시 시도해 주세요. 서버에 저장된 분석이 있으면 자동으로 열어 드려요.',
  },
  server_error: {
    title: '서버 오류가 났어요',
    body: '잠시 후 다시 시도해 주세요.',
  },
  missing_key: {
    title: '설정이 필요해요',
    body: '필요한 API 키가 설정되지 않았어요.',
  },
};

export interface ParsedProduct {
  brand: string;
  name: string;
  /** 규격 (예: 100g, 28cm, 500ml). 숫자와 단위를 함께. */
  spec: string;
  specAmount: number; // g / ml / cm 등 규격 숫자
  specUnit: 'g' | 'ml' | 'cm' | 'piece';
  quantity: number; // 팩/개 수
  price: number; // 공구 총액(원)
  shipping: number; // 배송비(원), 무료면 0
  freeShippingThreshold: number | null;
  category: 'food' | 'drink' | 'household' | 'other';
}

export interface SourceItem {
  title: string;
  url: string;
  price: number | null;
  unitPrice: number | null;
  source: string; // 지름알림, 11번가, 토스쇼핑 등
  kind: 'past_group' | 'regular' | 'similar';
  rating?: number | null; // 스니펫에서 찾은 평점(0~5)
}

export interface SimilarRow {
  name: string;
  unitPrice: number;
  price: number;
  url?: string;
  isThis: boolean;
  rating?: number | null;
}

export interface ProductResult {
  brand: string;
  name: string;
  spec: string;
  category: ParsedProduct['category'];
  unitLabel: string; // '100g당' | '100ml당' | '개당'
  price: number;
  shipping: number;
  effectivePrice: number;
  unitPrice: number;
  verdict: Verdict;
  verdictBasis: 'past_group' | 'similar' | 'regular' | 'none';
  pastGroupPrice: number | null;
  pastGroupCount: number;
  regularUnitPrice: number | null;
  similarMedian: number | null;
  similarMin: number | null;
  similarCount: number;
  cheapestSimilarName: string | null;
  rank: number | null; // 싼 순 순위 (1이 가장 쌈)
  totalInRank: number;
  similarRows: SimilarRow[];
  warnings: string[];
  sources: SourceItem[];
  rating?: number | null; // 이 상품 후기 평점 (0~5)
  reviewCount?: number | null; // 후기 개수
  ratingSource?: string | null; // 평점 출처 (도메인)
}

export interface AnalysisResult {
  id: number;
  createdAt: string;
  products: ProductResult[];
  cheapCount: number;
}

export function unitLabelFor(category: ParsedProduct['category']): string {
  if (category === 'food') return '100g당';
  if (category === 'drink') return '100ml당';
  return '개당';
}

/** 단위가격: 식품 100g당, 음료 100ml당, 생활용품 개당. 후라이팬은 절대 100g으로 환산하지 않는다. */
export function calcUnitPrice(p: ParsedProduct, effectivePrice: number): number {
  const totalAmount = p.quantity * (p.specAmount || 1);
  if (p.category === 'food' || p.category === 'drink') {
    return Math.round((effectivePrice / totalAmount) * 100);
  }
  // household / other: 개당
  return Math.round(effectivePrice / Math.max(1, p.quantity));
}

export function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function verdictLabel(v: Verdict): string {
  return v === 'cheap' ? '싸요' : v === 'fair' ? '보통' : v === 'expensive' ? '비싸요' : '판정보류';
}

export function formatWon(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '-';
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}
