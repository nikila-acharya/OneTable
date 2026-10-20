// TEST FIXTURE — planted banned-copy hits (asserted by check-banned-copy.test.mjs).
// treat this comment as safe: comments are never flagged
/* cure claims here are also just comment text */
export function Home({ burn }: { burn: number }) {
  const label = "guilt-free dinners";
  const note = 'Treats every family differently';
  return (
    <main>
      <p>Cheat meal ideas, nothing more</p>
      <span title="burn off calories">Fresh produce</span>
      <div>{label} — {note}</div>
    </main>
  );
}
