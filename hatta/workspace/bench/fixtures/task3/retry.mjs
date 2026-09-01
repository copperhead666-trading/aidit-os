import { DEFAULT_MAX_RETRIES } from './config.mjs';

export async function retry(fn, options = {}) {
  const maxRetries = DEFAULT_MAX_RETRIES; // BUG: ignores options.maxRetries override
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
