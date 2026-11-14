/* format.js — compact stat counts: under 1,000 exact, then 1.2k / 10k / 100k / 1M.
   The raw count is written straight into a 20px number in the popup, so
   1000000 would crowd its half of the stat row. Full number stays on hover.
   Shared by the popup (popup.html loads this first); see docs/ARCHITECTURE.md. */
"use strict";

function formatCount(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  if (n < 1000000) {
    const k = n / 1000;
    return (k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.floor(k)) + "k";
  }
  const m = n / 1000000;
  return (m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.floor(m)) + "M";
}
