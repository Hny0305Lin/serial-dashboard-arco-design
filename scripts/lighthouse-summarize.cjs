const fs = require('fs');

const file = process.argv[2];
if (!file) {
  process.stderr.write('Missing report path\n');
  process.exit(2);
}

const raw = fs.readFileSync(file, 'utf8');
const report = JSON.parse(raw);

function listCategoryFailures(categoryId) {
  const refs = report.categories?.[categoryId]?.auditRefs || [];
  const out = [];
  for (const ref of refs) {
    const id = ref.id;
    const a = report.audits?.[id];
    if (!a) continue;
    const score = a.score;
    if (score === 1) continue;
    out.push({ id, score, title: a.title });
  }
  out.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  return out;
}

const cats = ['performance', 'accessibility', 'best-practices', 'seo'];
for (const c of cats) {
  const score = report.categories?.[c]?.score;
  process.stdout.write(`${c}: ${typeof score === 'number' ? score : 'n/a'}\n`);
}

process.stdout.write('\nperformance metrics:\n');
for (const id of [
  'first-contentful-paint',
  'largest-contentful-paint',
  'speed-index',
  'interactive',
  'total-blocking-time',
  'cumulative-layout-shift',
]) {
  const a = report.audits?.[id];
  if (!a) continue;
  process.stdout.write(`- ${id} score=${a.score} ${a.displayValue || ''}\n`);
}

process.stdout.write('\naccessibility non-1 audits:\n');
for (const x of listCategoryFailures('accessibility')) {
  process.stdout.write(`- ${x.id} score=${x.score} ${x.title}\n`);
}
