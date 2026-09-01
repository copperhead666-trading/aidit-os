export function humanizeBytes(n) {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError('n must be a non-negative integer');
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = n;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  if (index === 0) {
    return `${Math.round(value)}B`;
  }
  return `${value.toFixed(1)}${units[index]}`;
}