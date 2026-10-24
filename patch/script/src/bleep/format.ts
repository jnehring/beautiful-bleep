// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// AssemblyScript has no toFixed: a number with a fixed count of decimals, by integer arithmetic. Used by the generated paramText.

export function formatNumber(value: f64, decimals: i32): string {
  let scale: i64 = 1;
  for (let i = 0; i < decimals; i++) scale *= 10;
  const scaled = <i64>Math.round(Math.abs(value) * <f64>scale);
  const sign = value < 0 && scaled != 0 ? "-" : "";
  if (decimals <= 0) return sign + scaled.toString();
  let fraction = (scaled % scale).toString();
  while (fraction.length < decimals) fraction = "0" + fraction;
  return sign + (scaled / scale).toString() + "." + fraction;
}
