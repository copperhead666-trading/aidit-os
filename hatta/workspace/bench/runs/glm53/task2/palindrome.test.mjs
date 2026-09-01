import assert from 'node:assert';
import { isPalindrome } from './palindrome.mjs';

assert.strictEqual(isPalindrome('racecar'), true, 'racecar should be palindrome');
assert.strictEqual(isPalindrome('hello'), false, 'hello should not be palindrome');
assert.strictEqual(isPalindrome('A man a plan a canal Panama'), true, 'phrase with spaces/case should be palindrome');
assert.strictEqual(isPalindrome('Was it a car or a cat I saw?'), true, 'phrase with punctuation should be palindrome');
assert.strictEqual(isPalindrome(''), true, 'empty string is palindrome');
console.log('ALL PASS');