# K-Padel Arena Manager

코트 예약, 리그 운영(아메리카노·멕시카노·라운드로빈), 순위, 회원가입을
지원하는 Next.js 앱입니다. 데이터는 Supabase(Postgres + Auth + Storage)에
저장되어 모든 방문자가 같은 데이터를 봅니다.

**설정 및 배포 방법은 [`MIGRATION_GUIDE.md`](./MIGRATION_GUIDE.md)를 확인하세요** —
Supabase 프로젝트 생성, SQL 실행 순서, Netlify 환경변수 설정, 기존 데이터
보존 방법까지 전부 단계별로 안내되어 있습니다.

## 로컬 개발

```
npm install
cp .env.local.example .env.local   # Supabase URL/anon key 입력
npm run dev
```

http://localhost:3000 에서 확인.
