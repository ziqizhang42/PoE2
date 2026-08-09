/** Half points keep the handicap exact, so a margin is never a fraction of one. */
export function formatHalfPoints(halfPoints: number): string {
  const whole = Math.floor(Math.abs(halfPoints) / 2);
  const half = Math.abs(halfPoints) % 2 === 1;

  if (whole === 0) {
    return half ? "½" : "0";
  }

  return half ? `${whole}½` : String(whole);
}
