// Vision-based design critique. Screenshot diffs tell you something *changed*;
// this tells you whether it looks *wrong* — the judgement call you currently
// make by hand. Run: node scripts/design-review.js [target-name ...]
import Anthropic from '@anthropic-ai/sdk';
import { chromium, devices } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const { targets } = JSON.parse(await readFile(join(root, 'targets.json'), 'utf8'));

const filter = process.argv.slice(2);
const selected = filter.length ? targets.filter(t => filter.includes(t.name)) : targets;
if (!selected.length) {
  console.error(`No matching targets. Known: ${targets.map(t => t.name).join(', ')}`);
  process.exit(1);
}

const VIEWPORTS = [
  { name: 'desktop', options: { viewport: { width: 1280, height: 800 } } },
  { name: 'mobile', options: devices['iPhone 13'] },
];

const RUBRIC = `You are a senior product designer reviewing a screenshot of a web page.

Judge only what is visible. Report concrete, fixable defects — not taste preferences.
Look for:
- Spacing: inconsistent gutters, cramped or orphaned elements, broken rhythm
- Alignment: items that should share an edge or baseline but don't
- Typography: too many sizes/weights, poor hierarchy, line length over ~75ch, clipped text
- Color & contrast: text that looks hard to read, muddy or clashing combinations
- Layout: awkward wrapping, dead space, elements that look cut off or overlapping
- Affordance: buttons that don't read as buttons, unclear primary action

Respond with ONLY a JSON object, no prose and no markdown fence:
{"verdict":"ship"|"minor-issues"|"needs-work",
 "issues":[{"severity":"high"|"medium"|"low","area":"<where on the page>","problem":"<what is wrong>","fix":"<specific change>"}],
 "summary":"<one sentence>"}
If nothing is wrong, return an empty issues array.`;

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error('Set ANTHROPIC_API_KEY (or run `ant auth login`) before running the design review.');
  process.exit(1);
}

const client = new Anthropic();
const browser = await chromium.launch();
const shotDir = join(root, 'design-review', 'shots');
await mkdir(shotDir, { recursive: true });

const findings = [];

for (const target of selected) {
  for (const pageDef of target.pages) {
    for (const vp of VIEWPORTS) {
      const label = `${target.name}/${pageDef.name}/${vp.name}`;
      process.stdout.write(`reviewing ${label} ... `);

      const context = await browser.newContext(vp.options);
      const page = await context.newPage();
      let shot;
      try {
        await page.goto(`http://localhost:4173/${target.name}${pageDef.path}`, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400); // let entrance animations finish before judging
        shot = await page.screenshot({ fullPage: true });
      } catch (err) {
        console.log(`skipped (${err.message.split('\n')[0]})`);
        await context.close();
        continue;
      }
      await context.close();

      const shotPath = join(shotDir, `${target.name}--${pageDef.name}--${vp.name}.png`);
      await writeFile(shotPath, shot);

      const response = await client.messages.create({
        model: 'claude-opus-5',
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        system: RUBRIC,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: shot.toString('base64') } },
            { type: 'text', text: `This is "${target.name}" (${pageDef.name}) at ${vp.name} width. Review it.` },
          ],
        }],
      });

      if (response.stop_reason === 'refusal') {
        console.log('refused by safety classifier');
        continue;
      }

      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      let parsed;
      try {
        // The model is told not to fence, but strip one if it appears anyway.
        parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
      } catch {
        console.log('unparseable response, skipping');
        continue;
      }

      findings.push({ label, shot: shotPath, ...parsed });
      console.log(`${parsed.verdict} (${parsed.issues.length} issues)`);
    }
  }
}

await browser.close();

const md = [
  '# Design review',
  `_${new Date().toISOString()}_`,
  '',
  ...findings.flatMap(f => [
    `## ${f.label} — **${f.verdict}**`,
    f.summary,
    '',
    ...(f.issues.length
      ? f.issues.map(i => `- **${i.severity}** · _${i.area}_ — ${i.problem}\n  - Fix: ${i.fix}`)
      : ['- No issues found.']),
    '',
  ]),
].join('\n');

const out = join(root, 'design-review', 'report.md');
await writeFile(out, md);
console.log(`\nWrote ${out}`);

// Non-zero exit if anything is seriously wrong, so CI can gate on it.
const blocking = findings.filter(f => f.verdict === 'needs-work');
if (blocking.length) {
  console.error(`${blocking.length} page(s) need work: ${blocking.map(f => f.label).join(', ')}`);
  process.exit(1);
}
