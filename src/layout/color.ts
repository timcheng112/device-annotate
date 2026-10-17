/** Deterministic region identity colors, with at least 4.5:1 contrast against white. */
export function regionColor(index: number): string {
  const hue = ((215 + index * 137.508) % 360) / 60;
  const chroma = 0.7 * 0.65, secondary = chroma * (1 - Math.abs(hue % 2 - 1)), offset = 0.35 - chroma / 2;
  const channels = hue < 1 ? [chroma, secondary, 0] : hue < 2 ? [secondary, chroma, 0] : hue < 3 ? [0, chroma, secondary]
    : hue < 4 ? [0, secondary, chroma] : hue < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
  let rgb = channels.map((value) => Math.round((value + offset) * 255));
  const linear = (value: number) => value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4;
  while (1.05 / (rgb.reduce((sum, value, i) => sum + linear(value) * [0.2126, 0.7152, 0.0722][i]!, 0) + 0.05) < 4.5) rgb = rgb.map((value) => Math.max(0, value - 1));
  return '#' + rgb.map((value) => value.toString(16).padStart(2, '0')).join('');
}
