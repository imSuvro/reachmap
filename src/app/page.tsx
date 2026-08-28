export default function Home() {
  // Stage-7 scaffold shell. The map product lands in stage 10 per docs/ux.md.
  return (
    <main style={{ display: "grid", placeItems: "center", height: "100%", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 480 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 32 }}>ReachMap</h1>
        <p style={{ color: "var(--muted)", marginTop: 8 }}>
          Where can Chennai&rsquo;s buses and metro take you in an hour? Interactive
          isochrones are on their way — this is the stage-7 deployment scaffold.
        </p>
      </div>
    </main>
  );
}
