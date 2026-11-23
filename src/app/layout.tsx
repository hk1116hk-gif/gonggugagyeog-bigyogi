import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '공구가격 비교기 — 이 공구, 싼 건가요?',
  description: '공구 게시글을 넣으면 과거 공구가·정가·비슷한 모델과 비교해 싸요/보통/비싸요를 판정합니다.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
