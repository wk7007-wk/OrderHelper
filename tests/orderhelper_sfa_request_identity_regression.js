const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert(/function createSfaRequestId\(now = Date\.now\(\)\)/.test(html), 'request id factory missing');
assert(/if \(!sfaLastRequestId\) sfaLastRequestId = createSfaRequestId\(now\);/.test(html), 'transport retry must retain the same request id');
assert(/requestId: sfaLastRequestId,\s*idempotencyKey: sfaLastRequestId,/.test(html), 'request and idempotency identities must match');
assert(/\['ok', 'already_applied', 'failed', 'no_file', 'error', 'request_error'\]/.test(html), 'terminal polling must clear a completed request identity');
assert(/if \(sfaLastRequestId && status\.requestId && status\.requestId !== sfaLastRequestId\) return;/.test(html), 'polling must remain terminal-correlated');
assert(/setInterval\(\(\) => loadSfaOrderStatus\(false\), 10000\);/.test(html), '10 second background status contract changed');
console.log('orderhelper SFA request identity regression: PASS');
