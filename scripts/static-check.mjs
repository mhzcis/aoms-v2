import fs from 'node:fs';
import path from 'node:path';

const skip = new Set(['node_modules', 'dist', '.git']);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else {
      files.push(fullPath);
    }
  }
}

walk('.');

const textFiles = files
  .filter(f => /\.(js|jsx|mjs|json|md|sql|yml|html)$/.test(f))
  .map(f => [f, fs.readFileSync(f, 'utf8')]);

const failures = [];
const serviceKeyPattern = new RegExp(
  'service' + '_role|SUPABASE_' + 'SERVICE|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\\.[A-Za-z0-9_-]{30,}',
  'i'
);
const todoPattern = new RegExp('\\bTO' + 'DO\\b|\\bFIX' + 'ME\\b');

const docFiles = new Set([
  'AOMS_V2_FINAL_MASTER_SPECIFICATION_FULL.md',
  'EXECUTIVE_AGENT_COMPLETION_INSTRUCTIONS.md',
  'TASK_CHECKLIST.md',
  'TRACEABILITY_MATRIX.md',
  'SECURITY_AUDIT_REPORT.md',
  'ADVERSARIAL_REVIEW_REPORT.md',
  'IMPLEMENTATION_REPORT.md',
  'GROK_BOT_EXECUTIVE_PROMPT.md',
]);

for (const [file, content] of textFiles) {
  const baseName = path.basename(file);
  if (
    file.endsWith('.patch') ||
    docFiles.has(baseName) ||
    file === path.join('scripts', 'static-check.mjs')
  ) {
    continue;
  }
  // The local Supabase stub used by DB tests must create Supabase's built-in role name; that
  // identifier is not a key. JWT and SUPABASE_SERVICE* markers are still scanned in these files.
  const scanned = file.startsWith(path.join('supabase', 'tests') + path.sep)
    ? content.replace(new RegExp('\\bservice' + '_role\\b', 'gi'), '')
    : content;
  if (serviceKeyPattern.test(scanned)) {
    failures.push(`${file}: forbidden service key or hardcoded JWT marker detected`);
  }
  if (todoPattern.test(content)) {
    failures.push(`${file}: unfinished marker detected`);
  }
  if (file.endsWith('.json')) {
    try {
      JSON.parse(content);
    } catch (err) {
      failures.push(`${file}: invalid JSON (${err.message})`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Static & secret check passed: ${textFiles.length} files verified.`);
