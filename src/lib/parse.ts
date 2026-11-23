import type { ParsedProduct } from './types';

/**
 * 키가 없을 때 쓰는 정규식 파서 (결정적, 오프라인 동작).
 * "브랜드 상품명 100g 30팩 29,700원" 같은 줄에서 상품을 뽑는다.
 * LLM 파서가 1차, 이 파서는 폴백이다.
 */
const PRICE_RE = /(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/g;

function categoryOf(name: string): ParsedProduct['category'] {
  if (/프라이팬|궁중팬|냄비|후라이팬|계란말이팬|뚜껑|세트|팬/.test(name)) return 'household';
  if (/음료|주스|우유|커피|차|물|콜라|사이다|ml|mL/.test(name)) return 'drink';
  if (/닭가슴살|소스|과자|라면|김|쌀|고기|치킨|스테이크|슬라이스|스팀/.test(name)) return 'food';
  return 'other';
}

export function parsePostWithRegex(postText: string): ParsedProduct[] {
  const lines = postText.split('\n').map((l) => l.trim()).filter(Boolean);
  const products: ParsedProduct[] = [];

  for (const line of lines) {
    if (products.length >= 6) break;
    // 배송비·무료배송 기준액은 상품가가 아니다 — 먼저 제거한다.
    const cleaned = line
      .replace(/배송비\s*\d{1,3}(?:,\d{3})*\s*원/g, '')
      .replace(/\d{1,3}(?:,\d{3})*\s*원\s*이상[^.\n]*무료배송/g, '');
    const prices = [...cleaned.matchAll(PRICE_RE)].map((m) => Number(m[1].replace(/,/g, '')));
    if (!prices.length) continue;
    // 상품가는 줄의 첫 번째 가격이다 (배송비는 위에서 제거됨).
    const price = prices[0];

    const specMatch = line.match(/(\d+(?:\.\d+)?)\s*(g|kg|ml|L|cm|개|팩)/);
    let specAmount = 1;
    let specUnit: ParsedProduct['specUnit'] = 'piece';
    let spec = '1개';
    if (specMatch) {
      const num = Number(specMatch[1]);
      const unit = specMatch[2];
      if (unit === 'kg') { specAmount = num * 1000; specUnit = 'g'; spec = `${num}kg`; }
      else if (unit === 'L') { specAmount = num * 1000; specUnit = 'ml'; spec = `${num}L`; }
      else if (unit === 'g') { specAmount = num; specUnit = 'g'; spec = `${num}g`; }
      else if (unit === 'ml') { specAmount = num; specUnit = 'ml'; spec = `${num}ml`; }
      else if (unit === 'cm') { specAmount = num; specUnit = 'cm'; spec = `${num}cm`; }
      else { specAmount = 1; specUnit = 'piece'; spec = '1개'; }
    }
    const qtyMatch = line.match(/(\d+)\s*(?:팩|개|세트)/);
    const quantity = qtyMatch ? Number(qtyMatch[1]) : 1;

    // 상품명: 가격 앞부분에서 브랜드+이름을 대충 떼어낸다.
    const namePart = line.split(/(\d[\d,]*\s*원)/)[0].replace(/^[•\-·\s]+/, '').trim();
    const name = namePart.slice(0, 60) || '상품';
    const brand = name.split(/\s+/)[0] ?? '';

    const shipping = /무료배송/.test(line) ? 0 : 3000;
    const freeMatch = postText.match(/(\d{1,3}(?:,\d{3})+)\s*원\s*이상[^.\n]*무료배송/);
    products.push({
      brand,
      name,
      spec,
      specAmount,
      specUnit,
      quantity,
      price,
      shipping,
      freeShippingThreshold: freeMatch ? Number(freeMatch[1].replace(/,/g, '')) : null,
      category: categoryOf(name),
    });
  }
  return products;
}

/** 상품 키 정규화 — DB 과거 가격 조회용. */
export function productKey(p: { brand: string; name: string; spec: string }): string {
  return `${p.brand} ${p.name} ${p.spec}`.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 다른 형태 제외: 스팀 vs 스테이크/슬라이스, 프라이팬 vs 궁중팬 등 형태 키워드가 다르면 비교군에서 제외. */
const FORM_KEYWORDS = ['스팀', '스테이크', '슬라이스', '궁중팬', '프라이팬', '계란말이팬', '훈제', '소스'];
export function sameForm(a: string, b: string): boolean {
  const fa = FORM_KEYWORDS.find((k) => a.includes(k));
  const fb = FORM_KEYWORDS.find((k) => b.includes(k));
  if (fa && fb) return fa === fb;
  return true;
}

/** 규격 ±35% 안인지 (단위가 같을 때만). */
export function specWithin(a: ParsedProduct, specAmount: number, specUnit: string): boolean {
  if (a.specUnit !== specUnit) return false;
  if (!a.specAmount || !specAmount) return true;
  const ratio = specAmount / a.specAmount;
  return ratio >= 0.65 && ratio <= 1.35;
}
