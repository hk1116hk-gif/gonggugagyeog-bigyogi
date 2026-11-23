import { NextResponse } from 'next/server';
import { safeDb } from '@/lib/db';
import type { ProductResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const list = await safeDb((db) =>
    db.analysis.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { products: { select: { name: true, verdict: true } } },
    }),
  );
  return NextResponse.json({
    ok: true,
    analyses: (list ?? []).map((a) => ({
      id: a.id,
      createdAt: a.createdAt.toISOString(),
      productCount: a.products.length,
      cheapCount: a.products.filter((p) => p.verdict === 'cheap').length,
      preview: a.products.map((p) => p.name).join(', '),
    })),
  });
}

export type { ProductResult };
