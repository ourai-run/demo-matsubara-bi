// 数字の見せ方。差は「+」「▲」で表す。
const abs = (v: number, digits: number) => Math.abs(v).toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const isZero = (s: string) => Number(s.replace(/,/g, "")) === 0;
/** マイナスは ▲ で表す（丸めて0になる値に符号は付けない）。 */
export const fmt = (v: number, digits = 0) => {
  if (!Number.isFinite(v)) return "—";
  const s = abs(v, digits);
  return v < 0 && !isZero(s) ? "▲" + s : s;
};
export const signed = (v: number, digits = 0) => {
  if (!Number.isFinite(v)) return "—";
  const s = abs(v, digits);
  return isZero(s) ? "±" + s : (v > 0 ? "+" : "▲") + s;
};
export const mil = (yen: number, digits = 1) => fmt(yen / 1e6, digits);
export const milSigned = (yen: number, digits = 1) => signed(yen / 1e6, digits);
export const rate = (a: number, b: number) => (b ? (a / b) * 100 : NaN);
/** 差が良い方向か悪い方向か。good は「増えると良い(1)／悪い(-1)／どちらでもない(0)」。 */
export const tone = (diff: number, good: number, eps = 1e-9) => (Math.abs(diff) < eps || !good ? "" : diff * good > 0 ? "pos" : "neg");
export const dateTime = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
