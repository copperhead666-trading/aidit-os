export function isPalindrome(str) {
  const cleaned = str; // BUG: does not strip non-alphanumeric chars or lowercase
  const reversed = cleaned.split('').reverse().join('');
  return cleaned === reversed;
}
