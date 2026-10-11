'use strict';
try {
  const h=JSON.parse(require('node:fs').readFileSync('/tmp/kress-health.json','utf8'));
  process.exit(Date.now()-h.at<90000 && h.local && h.cloud && !h.auth_error && !h.stopped ? 0:1);
} catch {process.exit(1);}
