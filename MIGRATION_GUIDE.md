# Supabase 연동 가이드

이 문서는 K-Padel Arena Manager를 Supabase에 연결하고, Netlify에 배포하고,
(해당되는 경우) 기존 데이터를 보존하는 전체 절차입니다.

## 0. 무엇이 바뀌었나

- 데이터 저장소가 Upstash Redis(키-값 저장)에서 **Supabase Postgres**(관계형
  테이블)로 바뀌었습니다.
- 로그인은 자체 SHA-256 해시 방식 대신 **Supabase Auth**를 씁니다. 화면에
  보이는 "아이디+비밀번호" 입력은 그대로지만, 내부적으로는
  `아이디@padelconnect.invalid`라는 실제로 존재하지 않는 이메일 주소로
  변환해 Supabase Auth에 로그인시킵니다 (RFC 2606에 정의된, 어떤 메일도
  절대 도달하지 않는 예약된 도메인입니다).
- 사진은 Supabase Storage에 올라가고, 그 주소만 데이터베이스에 저장됩니다.
- **알려진 제한사항**: 라운드로빈(팀전) 포맷은 이번 작업에서 아직
  Supabase에 연결하지 못했습니다 — 팀을 별도 테이블로 정식 분리하는
  작업이 더 필요해서, 지금은 세션 중에만 동작하고 새로고침하면
  사라집니다. 아메리카노·멕시카노(개인전)는 완전히 연결되어 있습니다.

## 1. Supabase 프로젝트 만들기

1. [supabase.com](https://supabase.com) → **New project** → 이름, 비밀번호, 리전(서울과 가까운 `ap-northeast-2` 추천) 설정.
2. 프로젝트 생성이 끝나면 좌측 **SQL Editor**로 이동합니다.

## 2. SQL 파일 3개를 순서대로 실행

**반드시 이 순서로** 실행하세요. 전부 "존재하면 만들지 않음" 방식이라
여러 번 실행해도 안전합니다 (데이터를 지우는 구문은 전혀 없습니다).

1. `supabase/001_schema.sql` — 테이블 생성 (profiles, clubs, club_members, courts, matches, bookings, booking_participants)
2. `supabase/002_rls_policies.sql` — 보안 정책(RLS) 적용
3. `supabase/003_storage_buckets.sql` — 사진 저장용 Storage 버킷 4개 생성

각 파일을 열어 전체 내용을 복사 → SQL Editor에 붙여넣기 → **Run**.

## 3. Auth 설정 변경 (중요)

아이디 기반 로그인은 실제 이메일이 아니므로, 이메일 인증을 꺼야 합니다.

**Authentication → Providers → Email** → **"Confirm email"을 OFF**로 변경 → Save.

(이 설정을 켜둔 채로 두면 모든 회원가입이 "이메일을 확인해 주세요" 상태에서
멈춰버립니다.)

## 4. URL과 anon key 확인

**Project Settings → API**에서 두 값을 복사해 둡니다.

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- anon public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

(anon key는 브라우저에 노출돼도 안전합니다 — 실제 접근 제어는 2단계에서
적용한 RLS 정책이 담당합니다.)

## 5. Netlify에 환경변수 설정하기

Netlify 대시보드에서:

**Site configuration → Environment variables → Add a variable**

다음 두 개를 추가합니다 (Scope는 기본값인 "All scopes"로 둬도 됩니다):

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 4단계에서 복사한 Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 4단계에서 복사한 anon key |

CLI를 쓴다면:
```
netlify env:set NEXT_PUBLIC_SUPABASE_URL "https://xxxx.supabase.co"
netlify env:set NEXT_PUBLIC_SUPABASE_ANON_KEY "ey..."
```

설정 후 **Deploys → Trigger deploy**로 재배포하세요 (환경변수는 다음
빌드부터 적용됩니다).

로컬에서 테스트하려면 `.env.local.example`을 `.env.local`로 복사하고 같은
값을 채운 뒤 `npm install && npm run dev`.

## 6. 기존 데이터 보존하기 (해당되는 경우만)

이 단계는 **Vercel + Upstash 버전을 실제로 배포해서 썼고, 그 안에 실제
회원/예약 데이터가 있는 경우에만** 필요합니다. 채팅 아티팩트 미리보기만
사용하셨다면 각자의 브라우저에만 개인적으로 저장된 테스트 데이터라
보존할 "공유 데이터"가 원래 없었으니 이 단계를 건너뛰셔도 됩니다.

1. **내보내기** (Upstash 자격 증명이 있는 곳에서 실행):
   ```
   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
     node scripts/export-from-upstash.mjs
   ```
   → `legacy-export.json` 생성됨. **이 파일을 열어 내용을 한번 확인하세요.**

2. **가져오기** (Supabase Service Role 키 필요 — Project Settings → API →
   `service_role` secret):
   ```
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
     node scripts/import-to-supabase.mjs
   ```
   이 스크립트는 **추가만** 합니다 — 기존 Supabase 데이터를 지우거나
   덮어쓰지 않습니다.

3. **중요 — 비밀번호는 옮길 수 없습니다.** 예전 시스템은 비밀번호를
   되돌릴 수 없는 해시로만 저장했기 때문에(이게 올바른 보안 방식입니다),
   원래 비밀번호 자체를 저장한 적이 없습니다. 그래서 마이그레이션된 모든
   회원은 `needs_password_reset = true`로 표시되고, **다음 로그인 전에
   반드시 비밀번호를 새로 받아야 합니다.**

   지금 버전은 이메일 발송 기반의 "비밀번호를 잊으셨나요" 자동 복구를
   아직 연결하지 않았습니다 (이메일 발송 서비스 연동이 추가로 필요해요).
   대신:
   - **관리자 지원 재설정**: Supabase Dashboard → Authentication →
     Users에서 해당 사용자를 찾아 **Send password recovery** 또는
     직접 새 비밀번호를 설정해 알려주는 방식으로 임시 처리할 수 있습니다.
   - 완전한 자동 "비밀번호 찾기" 기능이 필요하시면 말씀해 주세요 —
     Resend/SendGrid 같은 이메일 서비스를 연결해서 만들어 드릴게요.

## 7. 변경/추가된 파일 전체 목록

| 파일 | 역할 |
|---|---|
| `supabase/001_schema.sql` | 테이블 생성 |
| `supabase/002_rls_policies.sql` | 보안 정책(RLS) |
| `supabase/003_storage_buckets.sql` | 사진 저장 버킷 + 정책 |
| `lib/supabaseClient.js` | Supabase 클라이언트 초기화 |
| `lib/auth.js` | 아이디+비밀번호 ↔ Supabase Auth 연결 |
| `lib/db.js` | 클럽/코트/경기/예약/사진 읽기·쓰기 + 실시간 동기화 |
| `PadelLeagueApp.jsx` | 기존 화면은 그대로, 데이터 저장 방식만 Supabase로 교체 |
| `app/page.js` | 변경 없음 (예전 KV polyfill import만 제거) |
| `netlify.toml` | Netlify 빌드 설정 |
| `.env.local.example` | 로컬 개발용 환경변수 예시 |
| `scripts/export-from-upstash.mjs` | (선택) 예전 Upstash 데이터 내보내기 |
| `scripts/import-to-supabase.mjs` | (선택) Supabase로 가져오기 |
| `app/api/kv/route.js`, `lib/storagePolyfill.js` | **삭제됨** (예전 Upstash 방식, 더 이상 불필요) |

## 8. 점검한 내용 / 점검하지 못한 내용

**점검함**: TypeScript 컴파일러로 전체 파일의 문법 오류 확인, 모든
`lib/db.js` · `lib/auth.js` 함수 호출이 실제 내보낸 함수와 정확히
일치하는지 대조, React 렌더링 테스트로 5개 탭 전부 + 회원가입/로그인
화면 + "클럽 없음" 화면까지 실제 렌더링해서 오류 없이 뜨는 것 확인
(아메리카노·멕시카노·라운드로빈 포맷 전부 포함).

**점검 못함**: 실제 Supabase 프로젝트가 없어서(네트워크 접근 불가), SQL이
실제로 문제없이 실행되는지와 로그인·예약 등 실제 데이터 흐름은 이
환경에서 직접 테스트하지 못했습니다. 위 단계대로 연결한 뒤 안 되는
부분이 있으면 오류 메시지와 함께 알려주세요.
