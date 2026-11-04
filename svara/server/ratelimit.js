'use strict';
/** Token bucket: har bir kalit uchun `rate` token/sek, maksimal `burst`. */
function createLimiter({ rate, burst, maxKeys = 50000 }) {
  const buckets = new Map();
  return function take(key, cost = 1) {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) {
      if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
      b = { tokens: burst, at: now };
      buckets.set(key, b);
    }
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * rate);
    b.at = now;
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
  };
}
module.exports = { createLimiter };
