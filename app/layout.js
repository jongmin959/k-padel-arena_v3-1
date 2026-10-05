export const metadata = {
  title: "K-Padel Arena Manager",
  description: "코트 예약 · 리그 운영 · 순위 관리",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
