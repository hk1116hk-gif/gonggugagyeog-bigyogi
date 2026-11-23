import type { ParsedProduct, SourceItem } from './types';

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 스니펫/제목에서 가격(원)을 뽑는다. "19,490원" / "19,490" 형태. */
export function extractPrices(text: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const v = Number(m[1].replace(/,/g, ''));
    if (v >= 1000 && v <= 10000000) out.push(v);
  }
  return out;
}

async function searchTavily(query: string): Promise<SearchHit[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, search_depth: 'advanced', max_results: 8 }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (json.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
    source: domainOf(r.url ?? ''),
  }));
}

async function searchSerpApi(query: string): Promise<SearchHit[]> {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) return [];
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${key}&num=8&hl=ko&gl=kr`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) return [];
  const json = (await res.json()) as { organic_results?: Array<{ title?: string; link?: string; snippet?: string; source?: string }> };
  return (json.organic_results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.link ?? '',
    snippet: r.snippet ?? '',
    source: r.source ?? domainOf(r.link ?? ''),
  }));
}

async function searchBrave(query: string): Promise<SearchHit[]> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8&country=KR`, {
    headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string; profile?: { name?: string } }> } };
  return (json.web?.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.description ?? '',
    source: r.profile?.name ?? domainOf(r.url ?? ''),
  }));
}

/** Tavily → SerpAPI → Brave 순서로 폴백. */
export async function webSearch(query: string): Promise<SearchHit[]> {
  for (const fn of [searchTavily, searchSerpApi, searchBrave]) {
    try {
      const hits = await fn(query);
      if (hits.length) return hits;
    } catch {
      // 다음 제공자로 폴백
    }
  }
  return [];
}

/**
 * 검색 히트에서 가격 오퍼를 뽑는다.
 * 핵심 교훈(아티팩트): 4개 블록을 합친 거대한 단일 추출 호출은 타임아웃으로 죽는다.
 * 그래서 가격 추출은 정규식(결정적)으로 하고, LLM은 파싱에만 쓴다.
 * 블록별 병렬이 필요하면 호출부에서 Promise.all로 나눠 부른다.
 */
export function hitsToSources(
  hits: SearchHit[],
  kind: SourceItem['kind'],
  product: ParsedProduct,
): SourceItem[] {
  const seen = new Set<string>();
  const out: SourceItem[] = [];
  for (const hit of hits) {
    const prices = extractPrices(`${hit.title} ${hit.snippet}`);
    if (!prices.length) continue;
    // 스니펫에 여러 가격이 있으면 가장 작은 값(특가)을 쓴다 — 소비자가는 제외 경향.
    const price = Math.min(...prices);
    const key = `${hit.url}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: hit.title,
      url: hit.url,
      price,
      unitPrice: toUnitPrice(price, product),
      source: hit.source,
      kind,
    });
  }
  return out;
}

/** 검색 오퍼 가격을 해당 상품의 단위가격으로 환산 (규격이 다르면 null). */
export function toUnitPrice(price: number, product: ParsedProduct): number | null {
  if (product.category === 'food' || product.category === 'drink') {
    if (!product.specAmount) return null;
    return Math.round((price / product.specAmount) * 100);
  }
  return price; // 개당
}
