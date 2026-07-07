"use client";

// Last-resort boundary: catches errors thrown by the ROOT layout itself, where
// no app chrome (fonts, theme) is available — hence inline styles and its own
// <html>/<body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="az">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d0d0f",
          color: "#fafafa",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>Nəsə xəta baş verdi</h1>
          <p style={{ marginTop: 8, fontSize: 14, color: "#a1a1aa" }}>
            Gözlənilməz xəta yarandı. Yenidən cəhd edin.
          </p>
          {error.digest && (
            <p style={{ marginTop: 8, fontSize: 12, color: "#52525b" }}>
              Xəta kodu: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              padding: "10px 18px",
              borderRadius: 8,
              border: "none",
              background: "#f43f5e",
              color: "#fff",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Yenidən cəhd et
          </button>
        </div>
      </body>
    </html>
  );
}
