"use client";

// Replaces the root layout when it crashes, so it carries its own <html> and plain inline styles
// (the stylesheet may be the thing that failed to load).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f4f6fa", color: "#1e2b4a", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 440, margin: "0 auto", minHeight: "100dvh", display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, padding: "0 20px" }}>
          <h1 style={{ fontSize: 30, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#5e6a85", margin: 0 }}>Your plan and files are safe. Reload the page and try again.</p>
          {error.digest && <p style={{ color: "#5e6a85", fontSize: 14, margin: 0 }}>Reference: {error.digest}</p>}
          <button
            onClick={reset}
            style={{ alignSelf: "flex-start", height: 40, padding: "0 16px", border: 0, borderRadius: 6, background: "#1e2b4a", color: "#fff", fontWeight: 700, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
