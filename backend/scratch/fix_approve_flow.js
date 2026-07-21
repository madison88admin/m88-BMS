const fs = require('fs');
const file = 'src/routes/requests.ts';
let content = fs.readFileSync(file, 'utf8');

// Normalize CRLF to LF for matching
const normalized = content.replace(/\r\n/g, '\n');

// Find the block to replace - from "needsVpApproval" to "const nextStatus = 'pending_vp';"
const startMarker = '  // Budget proposals and requests >= VP_THRESHOLD go to VP; below threshold: release directly';
const endMarker = "  // Above threshold or budget flow: route to VP\n  const nextStatus = 'pending_vp';";

const startIdx = normalized.indexOf(startMarker);
const endIdx = normalized.indexOf(endMarker);

if (startIdx === -1) {
  console.log('FAILED: start marker not found');
  process.exit(1);
}
if (endIdx === -1) {
  console.log('FAILED: end marker not found');
  process.exit(1);
}

const endIdxFull = endIdx + endMarker.length;
const oldBlock = normalized.substring(startIdx, endIdxFull);

const newBlock = `  // Budget proposals go to VP; expense requests <30K → VP, >=30K → President
  const nextStatus = budgetFlow
    ? 'pending_vp'
    : requestAmount >= VP_THRESHOLD
      ? 'pending_president'
      : 'pending_vp';`;

const result = normalized.substring(0, startIdx) + newBlock + normalized.substring(endIdxFull);

// Write back with CRLF
fs.writeFileSync(file, result.replace(/\n/g, '\r\n'), 'utf8');
console.log('SUCCESS: Replaced approve-accounting routing');
console.log('Old block length:', oldBlock.length);
console.log('New block length:', newBlock.length);
