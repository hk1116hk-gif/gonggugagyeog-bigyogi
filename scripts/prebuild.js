// 빌드 전 준비: DATABASE_URL이 Postgres면 Postgres용 클라이언트를 만들고 테이블을 만든다.
// (이 샌드박스에서는 Neon으로 나가는 TLS가 막혀 있어 로컬 push가 안 되지만, Vercel 빌드에서는 된다.)
// SQLite(로컬)면 기존대로 SQLite용 클라이언트만 만든다.
const { execSync } = require('child_process');

const url = process.env.DATABASE_URL || '';
function run(cmd) {
  console.log(`[prebuild] ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

if (url.startsWith('postgresql://') || url.startsWith('postgres://')) {
  run('npx prisma generate --schema=prisma/schema.postgres.prisma');
  try {
    run('npx prisma db push --schema=prisma/schema.postgres.prisma --accept-data-loss');
  } catch (e) {
    console.log('[prebuild] db push 실패 — 앱은 뜨고, 분석 저장은 DB 연결 뒤에 다시 시도됩니다.');
  }
} else {
  run('npx prisma generate');
}
