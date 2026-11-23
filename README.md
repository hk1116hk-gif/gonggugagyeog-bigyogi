# 공구가격 비교기 (gonggugagyeog-web)

공구 게시글을 입력하면 웹에서 과거 공구가·정가·비슷한 모델을 찾아
**"이 공구가 싼 건지"**를 판정하는 웹 서비스입니다.
Muse 아티팩트(풀스택) 버전을 그대로 옮긴 독립 Next.js 레포로,
GitHub에 푸시해 Vercel에 배포할 수 있습니다.

## 기능

- 입력: 공구 게시글 본문 붙여넣기, 이미지 붙여넣기(Ctrl+V)·드래그·파일 선택(최대 3장),
  읽을 수 있는 링크. 뽐뿌 링크는 서버에서 403으로 막혀 읽을 수 없어 본문 복사를 안내합니다.
- 파싱: 최대 6개 상품(브랜드·이름·규격·수량·가격·배송비·무료배송 기준).
  식품 100g당, 음료 100ml당, 생활용품(후라이팬 등) 개당으로 단위가격을 계산합니다.
  후라이팬은 절대 100g으로 환산하지 않습니다.
- 탐색(상품당 3단계): ① 동일 상품 과거 공구가 ② 현재 정가 ③ 비슷한 모델
  (같은 종류·형태, 규격 ±35% 안, 스팀 vs 스테이크/슬라이스 등 다른 형태 제외).
- 판정: 싸요 / 보통 / 비싸요 / 판정보류.
  자체 과거 공구가가 있으면 그 중앙값이 1순위, 없으면 비슷한 모델 중앙값이 주 근거.
  정가보다 비싸거나 비슷한 모델보다 훨씬 비싸면 경고합니다.
- 비슷한 모델 비교는 순위표: 이 공구 + 비슷한 모델을 싼 순으로 정렬,
  모델마다 이름·단위가격·가격 막대, 옆에 "N원 싸요/비싸요 · P%" 배지.
  상단에 "중앙값 X원보다 Y원 싸요"와 "싼 순 N위"를 보여줍니다.
- 실패 원인은 각각 다른 한글 메시지로 표시합니다:
  `link_unreadable` / `no_products` / `parse_failed` / `image_unreadable` /
  `timeout` / `server_error` / `missing_key` (키 누락 시 키 이름을 명시).
- 분석 기록: 분석할 때마다 가격이 DB에 누적됩니다. 재분석 시 자기 자신의 가격과
  비교하지 않습니다(이번 분석 이전에 저장된 가격만 과거 공구가로 사용).
- 오래 걸리는 분석(6종 약 110초)이 끊겨도, 서버에 저장된 분석을 자동으로 찾아 열어줍니다.

## 로컬 실행

```bash
npm install
cp .env.example .env.local   # 키를 채우세요 (아래 참고)
npx prisma db push           # SQLite dev.db 생성
npm run dev                  # http://localhost:3000
npm run build
```

## 환경변수

| 변수 | 필수 | 설명 |
|---|---|---|
| `DATABASE_URL` | 필수 | 로컬 `file:./dev.db` (SQLite). 운영은 Postgres URL |
| `OPENAI_API_KEY` | 필수 | 상품 파싱·이미지 전사(Vision). 모델: `OPENAI_MODEL` (기본 `gpt-4o-mini`) |
| `TAVILY_API_KEY` | 필수* | 웹 검색. 없으면 SerpAPI/Brave 폴백, 셋 다 없으면 DB 과거 가격만으로 판정 |
| `SERPAPI_API_KEY` | 선택 | Tavily 폴백 |
| `BRAVE_API_KEY` | 선택 | Tavily/SerpAPI 폴백 |

키가 없으면 앱이 영문 오류 대신 "OPENAI_API_KEY가 설정되지 않았어요"처럼
한글로 어떤 키가 필요한지 알려줍니다.

## Vercel 배포

1. GitHub에 푸시합니다 (레포 주소는 아직 없습니다 — 받으면 푸시).
2. Vercel에서 Import Project → 프레임워크 Next.js.
3. Environment Variables에 위 표의 키들을 넣습니다.
   `DATABASE_URL`은 Vercel Postgres 또는 Neon의 Postgres URL을 넣습니다.
4. 운영 DB 스키마는 Postgres용입니다:
   ```bash
   npx prisma generate --schema=prisma/schema.postgres.prisma
   npx prisma db push --schema=prisma/schema.postgres.prisma
   ```
   (로컬 SQLite 스키마는 `prisma/schema.prisma`입니다. 두 파일의 모델은 동일합니다.)
5. `vercel.json`에 `/api/analyze`의 `maxDuration: 300`이 설정돼 있습니다.
   Vercel 무료 플랜은 함수 실행시간이 60초로 제한될 수 있어, 6종 분석이
   끊기면 앱이 저장된 분석을 자동으로 찾아 열어주는 복구 경로를 탑니다.
   안정적으로 쓰려면 Pro 플랜 또는 분석을 상품별로 나누는 것을 권장합니다.

## 구조

```
src/app/page.tsx            아이콘 중심 UI (입력·판정·순위표·히스토리)
src/app/api/analyze/route.ts  POST 분석 (maxDuration 300), GET 최근 분석 복구
src/app/api/analyses/route.ts GET 분석 목록
src/app/api/analyses/[id]/route.ts GET 분석 1건
src/lib/types.ts            타입·판정·단위가격·오류 메시지
src/lib/llm.ts              OpenAI 파싱(블록별 병렬 소형 호출)·이미지 전사
src/lib/search.ts           Tavily → SerpAPI → Brave 폴백, 정규식 가격 추출
src/lib/parse.ts            정규식 폴백 파서, 형태/규격 비교
src/lib/verdict.ts          판정 로직
src/lib/db.ts               Prisma 싱글턴
prisma/schema.prisma        로컬 SQLite 스키마
prisma/schema.postgres.prisma 운영 Postgres 스키마
```

## 알려진 한계

- 뽐뿌 링크는 서버가 읽을 수 없습니다(403). 본문 복사 또는 스크린샷 이미지를 넣어 주세요.
- 검색은 스니펫 기반이라, 상품 페이지에 직접 들어가 가격을 뽑는 방식보다
  동일 상품 과거 공구가·정가의 적중률이 낮을 수 있습니다.
  (향후: 네이버 쇼핑 API, 상품 페이지 직접 추출)
- 6종 분석은 약 110초가 걸릴 수 있습니다.
