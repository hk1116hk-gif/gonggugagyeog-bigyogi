import { NextResponse } from 'next/server';
import { safeDb } from '@/lib/db';
import type { ProductResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false, message: '잘못된 분석 ID예요.' }, { status: 400 });
  const a = await safeDb((db) => db.analysis.findUnique({ where: { id }, include: { products: true } }));
  if (!a) return NextResponse.json({ ok: false, message: '분석을 찾지 못했어요.' }, { status: 404 });
  return NextResponse.json({
    ok: true,
    id: a.id,
    createdAt: a.createdAt.toISOString(),
    products: a.products.map((p) => JSON.parse(p.resultJson) as ProductResult),
    cheapCount: a.products.filter((p) => p.verdict === 'cheap').length,
  });
}
