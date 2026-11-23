'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisResult, ProductResult } from '@/lib/types';
import { formatWon, verdictLabel } from '@/lib/types';

const SAMPLES: Array<{ label: string; text: string }> = [
  { label: '닭가슴살 4종', text: '맛있닭 스팀 닭가슴살 100g 30팩 29,700원 배송비 3,000원 40,000원 이상 무료배송\n랭커 스팀 닭가슴살 100g 20팩 21,800원 무료배송\n테팔 후라이팬 28cm 1개 32,900원 무료배송' },
  { label: '소시지 3종', text: '존쿡 델리미트 소시지 200g 10팩 24,900원 무료배송\n오뚜기 프랑크 소시지 250g 8팩 19,800원 배송비 3,000원\nCJ 비비고 소시지 180g 12팩 27,900원 무료배송' },
  { label: '단품 특가', text: '테팔 후라이팬 28cm 1개 32,900원 무료배송' },
  { label: '후라이팬 혼합', text: '해피콜 브릭스 통 3중 에칭 IH 스텐 프라이팬 28cm 1개 20,900원\n해피콜 브릭스 통 3중 에칭 IH 스텐 궁중팬 28cm 1개 21,900원\n해피콜 키친핏 IH 프라이팬 2P (프라이팬 20cm + 프라이팬 28cm) 24,900원' },
];

const STAGES = [
  { icon: '📄', title: '원본 분석', subs: ['게시글 글자 읽는 중…', '이미지 전사 중…', '가격·상품 정보 찾는 중…'] },
  { icon: '🧺', title: '상품 뽑기', subs: ['상품 나누는 중…', '브랜드·규격·가격 정리 중…', '세트·수량 확인 중…'] },
  { icon: '🔍', title: '가격 검색', subs: ['과거 공구가 찾는 중…', '일반 판매가 비교 중…', '비슷한 모델 찾는 중…', '출처 모으는 중…'] },
  { icon: '📊', title: '리포트 정리', subs: ['단위가격 계산 중…', '싸요·보통·비싸요 판정 중…', '비교표 정리 중…'] },
];
// 단계별 예상 경과 시간(초): 0단계 <10, 1단계 <20, 2단계 <45, 3단계 45초~
const STAGE_AT = [10, 20, 45];

function verdictIcon(v: ProductResult['verdict']) {
  return v === 'cheap' ? '👍' : v === 'fair' ? '😐' : v === 'expensive' ? '👎' : '❓';
}

export default function Home() {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const step = elapsed < STAGE_AT[0] ? 0 : elapsed < STAGE_AT[1] ? 1 : elapsed < STAGE_AT[2] ? 2 : 3;
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<Array<{ id: number; createdAt: string; productCount: number; cheapCount: number; preview: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch('/api/analyses');
      const j = await r.json();
      if (j.ok) setHistory(j.analyses);
    } catch { /* 히스토리 실패는 조용히 */ }
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const addImages = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!arr.length) return;
    arr.slice(0, 3 - images.length).forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => setImages((prev) => (prev.length < 3 ? [...prev, String(reader.result)] : prev));
      reader.readAsDataURL(f);
    });
  }, [images.length]);

  async function analyze() {
    setError(null);
    setResult(null);
    if (!text.trim() && !images.length) {
      setError('공구 게시글 본문이나 이미지를 넣어 주세요.');
      return;
    }
    setLoading(true);
    setElapsed(0);
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    try {
      // 이미지는 서버에서 AI 비전으로 전사한다. 브라우저 OCR(Tesseract)은
      // 숫자를 잘못 읽어('7,900원 80%' → '79,008원') 가격을 망가뜨려서 빼기로 했다.
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postText: text, images }),
      });
      const j = await res.json();
      if (!j.ok) {
        // 연결이 끊겼는데 서버에 저장이 됐을 수 있다 — 최근 분석을 자동으로 찾아본다.
        if (res.status === 504 || j.errorCode === 'timeout') {
          setElapsed(60);
          const rec = await fetch('/api/analyze');
          const rj = await rec.json();
          if (rj.ok) {
            setResult(rj);
            loadHistory();
            return;
          }
        }
        setError(j.message ?? '분석에 실패했어요.');
        return;
      }
      setResult(j);
      loadHistory();
    } catch {
      // 네트워크 끊김 — 저장된 분석 복구 시도
      try {
        const rec = await fetch('/api/analyze');
        const rj = await rec.json();
        if (rj.ok) { setResult(rj); loadHistory(); return; }
      } catch { /* 무시 */ }
      setError('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  }

  function copyTable() {
    if (!result) return;
    const lines = ['상품\t공구가\t단위가격\t판정\t비슷한 모델 중앙값\t차액'];
    for (const p of result.products) {
      const diff = p.similarMedian != null ? p.unitPrice - p.similarMedian : null;
      lines.push(`${p.brand} ${p.name} ${p.spec}\t${formatWon(p.effectivePrice)}\t${formatWon(p.unitPrice)}/${p.unitLabel}\t${verdictLabel(p.verdict)}\t${p.similarMedian != null ? formatWon(p.similarMedian) : '-'}\t${diff != null ? `${diff > 0 ? '+' : ''}${formatWon(diff)}` : '-'}`);
      for (const row of p.similarRows.filter((r) => !r.isThis)) {
        lines.push(`  └ ${row.name}\t${formatWon(row.price)}\t${formatWon(row.unitPrice)}/${p.unitLabel}\t-\t-\t${formatWon(p.unitPrice - row.unitPrice)}`);
      }
    }
    navigator.clipboard?.writeText(lines.join('\n'));
    alert('비교표를 복사했어요.');
  }

  async function openHistory(id: number) {
    const r = await fetch(`/api/analyses/${id}`);
    const j = await r.json();
    if (j.ok) setResult(j);
  }

  return (
    <main>
      <header>
        <h1>⚖️ 공구가격 비교기</h1>
        <p>이 공구, 싼 건가요?</p>
        <div className="chips">
          <span className="chip">🕘 과거 공구가</span>
          <span className="chip">🔍 비슷한 모델</span>
          <span className="chip">🏷️ 일반 판매가</span>
        </div>
      </header>

      <div className={`card${loading ? ' busy' : ''}`}>
        <textarea
          value={text}
          disabled={loading}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            const files: File[] = [];
            for (const it of Array.from(items)) if (it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) files.push(f); }
            if (files.length) addImages(files);
          }}
          placeholder="공구 게시글 본문을 붙여넣으세요. 링크만 넣으면 읽을 수 없는 사이트가 있어요."
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addImages(e.dataTransfer.files); }}
        />
        <div className="toolbar">
          <button className="toolbtn" onClick={() => fileRef.current?.click()}>🖼️ 이미지</button>
          <button className="toolbtn" onClick={() => setText((t) => t)}>🔗 링크</button>
          <span style={{ fontSize: 13, color: '#78716c' }}>🖼️ 이미지 {images.length}/3 · 캡처 복사 후 Ctrl+V · 드래그도 돼요</span>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) addImages(e.target.files); }} />
        </div>
        {images.length > 0 && (
          <div className="thumbs">
            {images.map((src, i) => (
              <div key={i} style={{ position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`이미지 ${i + 1}`} />
                <button className="toolbtn" style={{ position: 'absolute', top: -8, right: -8, padding: '2px 7px' }} onClick={() => setImages(images.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="samples">
          <span>✨ 샘플로 해보기</span>
          {SAMPLES.map((s) => (
            <button key={s.label} className="sample" onClick={() => setText(s.text)}>{s.label}</button>
          ))}
        </div>
      </div>

      <button className={`analyze${loading ? ' loading' : ''}`} onClick={analyze} disabled={loading}>
        {loading ? (<><span className="spin" />분석 중…</>) : '🔍 가격 판정하기'}
      </button>

      {loading && (
        <>
          <div className="progress"><i style={{ width: `${((step + 1) / STAGES.length) * 100}%` }} /></div>
          <div className="card stages">
            {STAGES.map((s, i) => {
              const status = i < step ? 'done' : i === step ? 'active' : 'todo';
              const sub = s.subs[Math.floor(elapsed / 3) % s.subs.length];
              return (
                <div key={s.title} className={`stage ${status}`}>
                  <span className="st-ic">
                    {status === 'done' ? '✓' : status === 'active' ? <span className="spin-sm" /> : s.icon}
                  </span>
                  <div className="st-tx">
                    <b>{s.title}</b>
                    {status === 'active' && <span key={sub} className="st-sub">{sub}</span>}
                    {status === 'done' && <span className="st-sub done">완료</span>}
                  </div>
                </div>
              );
            })}
            <div className="st-elapsed">⏱ {elapsed}초째 분석 중이에요</div>
          </div>
          <div className="card" aria-hidden>
            <div className="skel" style={{ height: 20, width: '55%', marginBottom: 12 }} />
            <div className="skel" style={{ height: 14, width: '80%', marginBottom: 8 }} />
            <div className="skel" style={{ height: 14, width: '65%' }} />
          </div>
        </>
      )}
      {error && <div className="err"><b>⚠️ 분석에 실패했어요</b>{error}</div>}

      {result && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 700 }}>결과 {result.products.length}개 상품 · 싸요 {result.cheapCount}개</span>
            <button className="copybtn" onClick={copyTable}>📋 비교표 복사</button>
          </div>
          {result.products.map((p, i) => (
            <div key={i} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div><b>{p.brand} {p.name}</b><div style={{ color: '#78716c', fontSize: 13 }}>{p.spec} · {p.unitLabel}</div></div>
                <span className={`badge ${p.verdict}`}>{verdictIcon(p.verdict)} {verdictLabel(p.verdict)}</span>
              </div>
              <div className="tiles">
                <div className="tile"><div className="ic">💰</div><div className="v">{formatWon(p.effectivePrice)}</div><div className="l">총액</div></div>
                <div className="tile"><div className="ic">🚚</div><div className="v">{p.shipping === 0 ? '무료' : formatWon(p.shipping)}</div><div className="l">배송</div></div>
                <div className="tile"><div className="ic">🕘</div><div className="v">{p.pastGroupPrice != null ? formatWon(p.pastGroupPrice) : '-'}</div><div className="l">과거 공구가 {p.pastGroupCount ? `(${p.pastGroupCount}건)` : ''}</div></div>
                <div className="tile"><div className="ic">🏷️</div><div className="v">{p.regularUnitPrice != null ? `${formatWon(p.regularUnitPrice)}/${p.unitLabel}` : '-'}</div><div className="l">일반가</div></div>
              </div>
              <div style={{ fontSize: 14 }}>단위가격 <b>{formatWon(p.unitPrice)}/{p.unitLabel}</b>
                {p.similarMedian != null && (
                  <span style={{ color: '#78716c' }}> · 중앙값 {formatWon(p.similarMedian)}보다 {formatWon(Math.abs(p.unitPrice - p.similarMedian))} {p.unitPrice <= p.similarMedian ? '싸요' : '비싸요'}</span>
                )}
                {p.rank != null && <span> · 싼 순 {p.rank}위/{p.totalInRank}</span>}
              </div>
              {p.warnings.map((w, j) => <div key={j} className="warn">⚠️ {w}</div>)}
              <div style={{ marginTop: 10, fontWeight: 700, fontSize: 14 }}>📊 비슷한 모델 순위</div>
              {p.similarRows.length > 0 ? (
                p.similarRows.map((row, j) => {
                  const max = Math.max(...p.similarRows.map((r) => r.unitPrice));
                  const diff = p.unitPrice - row.unitPrice;
                  return (
                    <div key={j} className="rankrow">
                      <span style={{ width: 18, fontWeight: 700 }}>{j + 1}</span>
                      <div style={{ flex: 1 }}>
                        <div className="nm">{row.isThis ? '⭐ ' : ''}{row.name}</div>
                        <div className="bar"><i className={row.isThis ? 'this' : ''} style={{ width: `${Math.max(8, (row.unitPrice / max) * 100)}%` }} /></div>
                      </div>
                      <span className="pr">{formatWon(row.unitPrice)}/{p.unitLabel}</span>
                      {!row.isThis && (
                        <span className={`diff ${diff <= 0 ? 'good' : 'bad'}`}>{diff <= 0 ? `${formatWon(-diff)} 싸요 · ${Math.round((-diff / row.unitPrice) * 100)}%` : `${formatWon(diff)} 비싸요 · ${Math.round((diff / row.unitPrice) * 100)}%`}</span>
                      )}
                    </div>
                  );
                })
              ) : (
                <div style={{ fontSize: 13, color: '#78716c' }}>비슷한 모델 가격을 찾지 못했어요. 이 공구·최저가·중앙값 비교만 보여줘요.</div>
              )}
              <details>
                <summary>출처 {p.sources.length}개</summary>
                {p.sources.map((s, j) => (
                  <div key={j}><a href={s.url} target="_blank" rel="noreferrer">{s.source} — {s.title}</a> · {s.price != null ? formatWon(s.price) : ''}</div>
                ))}
              </details>
            </div>
          ))}
        </>
      )}

      {history.length > 0 && (
        <div className="card hist">
          <b>🕘 이전 분석</b>
          {history.map((h) => (
            <button key={h.id} onClick={() => openHistory(h.id)}>
              #{h.id} · {new Date(h.createdAt).toLocaleString('ko-KR')} · {h.productCount}개 상품 · 싸요 {h.cheapCount}개 — {h.preview}
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
