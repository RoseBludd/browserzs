/**
 * Realistic roofing operator proof — bluebonnetpeakroofing (2026-10-04 standard).
 * Outputs: media/roofing-realistic-R1..R4.png + roofing-realistic-walkthrough-2026-10-04.mp4
 *
 * Long MCP/CADIS turns: set ROOFERZS_MCP_TURN_TIMEOUT_MS (default 900_000 ms per turn).
 */
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const MEDIA_DIR =
  process.env.ROOFERZS_MEDIA_DIR?.trim() ||
  '/root/.local/state/cursor/agent-stores/cursor_agent_stores/bc-49d94244-10a5-4a36-a7e1-22be46f6c8c8/files/media';

const TENANT = process.env.ROOFERZS_QA_TENANT?.trim() || 'bluebonnetpeakroofing';
const EMAIL = process.env.ROOFERZS_QA_EMAIL?.trim() || 'jordan.hale+restart1790915600@mailinator.com';
const PASSWORD = process.env.ROOFERZS_QA_PASSWORD?.trim() || 'RESTORE';

const PROMPT_R1 =
  "What's the storm risk near Dallas this week? Show me on the map if you can.";
const PROMPT_R1_FOLLOW =
  'Expand with a short hail outlook for North Texas and use a storm map or intel attachment if available.';
const PROMPT_R2 =
  'Suggest a door-knock route for hail-damaged blocks in Plano — what should my crew hit first?';
const PROMPT_R2_FOLLOW =
  'Give me a numbered checklist of streets or neighborhoods to prioritize for canvassing today.';
const PROMPT_R3 =
  'Summarize what this dashboard storm section means for my sales team today.';

const PNG_R1 = path.join(MEDIA_DIR, 'roofing-realistic-R1-storm.png');
const PNG_R2 = path.join(MEDIA_DIR, 'roofing-realistic-R2-canvass.png');
const PNG_R3 = path.join(MEDIA_DIR, 'roofing-realistic-R3-agent-embed.png');
const PNG_R4 = path.join(MEDIA_DIR, 'roofing-realistic-R4-dashboard.png');
const MP4 = path.join(MEDIA_DIR, 'roofing-realistic-walkthrough-2026-10-04.mp4');
const SUMMARY_JSON = path.join(MEDIA_DIR, 'roofing-realistic-capture-summary.json');
const MCP_TURN_TIMEOUT_MS = Number(process.env.ROOFERZS_MCP_TURN_TIMEOUT_MS || 900_000);

fs.mkdirSync(MEDIA_DIR, { recursive: true });
const videoDir = path.join(MEDIA_DIR, '_roofing-realistic-video');
fs.rmSync(videoDir, { recursive: true, force: true });
fs.mkdirSync(videoDir, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function linesAfterPrompt(text, prompt) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const userIdx = lines.lastIndexOf(prompt);
  if (userIdx < 0) return [];
  const out = [];
  for (let i = userIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^Thinking$/i.test(line)) continue;
    if (line === prompt) continue;
    out.push(line);
  }
  return out;
}

function proseAfterPrompt(text, prompt) {
  return linesAfterPrompt(text, prompt).join(' ');
}

function isSmokeTokenReply(text) {
  return /^(OK|CANVASS_OK|STORM_OK|Hello!?|Hi!?|Thanks!?|Thank you!?|Confirmed!?)$/i.test(text.trim());
}

function hasRichStormSignal(text, prompt) {
  const prose = proseAfterPrompt(text, prompt);
  if (isSmokeTokenReply(prose) || prose.length < 80) return false;
  if (/CANVASS_OK|STORM_OK/i.test(prose)) return false;
  const hasGeo = /Dallas|North Texas|DFW|hail|storm|risk|outlook|severe|watch|warning/i.test(prose);
  const hasMapUi =
    /storm-tracker|storm-tracker-map|maplibre|canvas|Full GIS|intel-attachment|checklist|table/i.test(text) ||
    /\[map\]|storm map/i.test(text);
  return hasGeo && (prose.length >= 120 || hasMapUi);
}

function hasRichCanvassSignal(text, prompt) {
  const prose = proseAfterPrompt(text, prompt);
  if (isSmokeTokenReply(prose) || /CANVASS_OK/i.test(prose)) return false;
  if (prose.length < 100) return false;
  return /Plano|canvass|door|knock|route|crew|neighborhood|block|checklist|priority|street/i.test(prose);
}

function hasRichPmSignal(text, prompt) {
  const prose = proseAfterPrompt(text, prompt);
  if (isSmokeTokenReply(prose) || prose.length < 120) return false;
  const sentences = prose.split(/[.!?]+/).filter((s) => s.trim().length > 15);
  if (sentences.length < 2) return false;
  return /sales|storm|team|dashboard|lead|outreach|today|Bluebonnet|roof/i.test(prose);
}

async function waitForRichReply(target, prompt, validate, timeoutMs = MCP_TURN_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  let sawNetwork = false;
  while (Date.now() < deadline) {
    last = await target.locator('body').innerText();
    if (/network error/i.test(last)) {
      if (!sawNetwork) {
        sawNetwork = true;
        await sleep(8000);
        continue;
      }
      throw new Error('network error in chat');
    }
    if (!/\bThinking\b/i.test(last) && validate(last, prompt)) {
      return { text: last, prose: proseAfterPrompt(last, prompt) };
    }
    await sleep(2000);
  }
  throw new Error(`timeout rich reply for "${prompt.slice(0, 60)}…" tail=${last.slice(-500)}`);
}

async function composer(target) {
  const c = target.locator('textarea, [contenteditable="true"]').first();
  await c.waitFor({ timeout: 90_000 });
  return c;
}

async function sendTurn(target, prompt) {
  const c = await composer(target);
  await c.fill(prompt);
  await c.press('Enter');
}

async function ensureSidebarOpen(target) {
  const show = target.getByRole('button', { name: /show sidebar/i });
  if ((await show.count()) > 0 && (await show.isVisible())) {
    await show.click();
    await sleep(1500);
  }
}

async function selectSeat(target, seatId, labelRe) {
  await ensureSidebarOpen(target);
  const byId = target.locator(`[data-seat-id="${seatId}"]`).first();
  if ((await byId.count()) > 0) await byId.click({ timeout: 30_000 });
  else await target.getByRole('button', { name: labelRe }).first().click({ timeout: 30_000 });
  await sleep(4000);
}

async function login(page) {
  await page.goto(`https://app.rooferzs.com/${TENANT}/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 90_000 });
}

async function tryPromptUntilRich(target, prompts, validate) {
  let lastResult = null;
  for (const p of prompts) {
    await sendTurn(target, p);
    try {
      lastResult = await waitForRichReply(target, p, validate, MCP_TURN_TIMEOUT_MS);
      lastResult.promptUsed = p;
      return lastResult;
    } catch (e) {
      lastResult = { error: String(e.message || e), promptUsed: p };
    }
  }
  throw new Error(`all prompts failed: ${JSON.stringify(lastResult)}`);
}

const meta = {
  tenant: TENANT,
  ok: false,
  prompts: {},
  errors: [],
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();

try {
  await login(page);
  await page.goto(`https://app.rooferzs.com/${TENANT}/dashboard/dynamic`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await sleep(10_000);
  const dashText = await page.locator('body').innerText();
  if (/No widgets configured/i.test(dashText) || /No KPIs configured/i.test(dashText)) {
    throw new Error('dashboard still empty after load');
  }
  if (!/Storm Watch|storm-map|Full GIS/i.test(dashText)) {
    throw new Error('storm section not visible on dynamic dashboard');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  await page.screenshot({ path: PNG_R4, fullPage: false });
  meta.R4 = true;

  await page.getByRole('button', { name: /open agent/i }).click({ timeout: 30_000 });
  await sleep(2500);
  const iframe = page.frameLocator('iframe[title="OpenBot roofing agent"]');
  await iframe.locator('textarea, [contenteditable="true"]').first().waitFor({ timeout: 90_000 });

  const r3 = await tryPromptUntilRich(iframe, [PROMPT_R3], hasRichPmSignal);
  meta.prompts.R3 = { prompt: r3.promptUsed, excerpt: r3.prose.slice(0, 500) };
  await page.screenshot({ path: PNG_R3, fullPage: false });
  meta.R3 = true;

  await selectSeat(iframe, 'rooferzs-storm', /storm/i);
  const r1 = await tryPromptUntilRich(iframe, [PROMPT_R1, PROMPT_R1_FOLLOW], hasRichStormSignal);
  meta.prompts.R1 = { prompt: r1.promptUsed, excerpt: r1.prose.slice(0, 500) };
  await page.screenshot({ path: PNG_R1, fullPage: false });
  meta.R1 = true;

  await selectSeat(iframe, 'rooferzs-canvassing', /canvassing/i);
  const r2 = await tryPromptUntilRich(iframe, [PROMPT_R2, PROMPT_R2_FOLLOW], hasRichCanvassSignal);
  meta.prompts.R2 = { prompt: r2.promptUsed, excerpt: r2.prose.slice(0, 500) };
  await page.screenshot({ path: PNG_R2, fullPage: false });
  meta.R2 = true;

  meta.ok = true;
} catch (e) {
  meta.errors.push(String(e.message || e));
  console.error(e);
  try {
    await page.screenshot({ path: path.join(MEDIA_DIR, 'roofing-realistic-capture-failure.png'), fullPage: false });
  } catch {
    /* ignore */
  }
} finally {
  await context.close();
  await browser.close();
}

if (meta.ok) {
  const webm = fs.readdirSync(videoDir).find((f) => f.endsWith('.webm'));
  if (webm) {
    execSync(
      `ffmpeg -y -i "${path.join(videoDir, webm)}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${MP4}"`,
      { stdio: 'inherit' },
    );
    meta.video = MP4;
  }
}

meta.at = new Date().toISOString();
fs.writeFileSync(SUMMARY_JSON, JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
process.exit(meta.ok ? 0 : 1);
