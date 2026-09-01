// humanizeBytes(n): format a non-negative integer byte count in binary units
// (B, KB, MB, GB; 1024 per step). KB/MB/GB get exactly 1 decimal place; B has none.

export function humanizeBytes(n) {
  if (!Number.isInteger(n) || n < 0) {
    throw new TypeError('humanizeBytes expects a non-negative integer');
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = n;
  let i = 0;

  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }

  if (i === 0) {
    return `${value}B`;
  }
  return `${value.toFixed(1)}${units[i]}`;
}