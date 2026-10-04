/**
 * Full roofing capability proof — bluebonnetpeakroofing (2026-10-04).
 * S1–S8, E1–E5, O+, S9 video. Requires OpenBot idleTimeout fix + MCP network.
 */
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const MEDIA_DIR =
  process.env.ROOFERZS_MEDIA_DIR?.trim() ||
  '/root/.local/state/cursor/agent-stores/cursor_agent_stores/bc-49d94244-10a5-4a36-a7e1-22be46f6c8c8/files/media';

const TENANT = 'bluebonnetpeakroofing';
const EMAIL = 'jordan.hale+restart1790915600@mailinator.com';
const PASSWORD = 'RESTORE';

const SKIP_UNTIL = process.env.ROOFERZS_SKIP_UNTIL?.trim() || '';
const ONLY_IDS = process.env.ROOFERZS_ONLY_IDS?.trim()
  ? process.env.ROOFERZS_ONLY_IDS.split(',').map((s) => s.trim()).filter(Boolean)
  : null;
const INFRA_LEAK_RE =
  /\b(mcp[-_]|list_workflows|list_campaigns|enroll_lead_in_workflow|emailzs\.com|geniuzs\.com|maps\.geniuzs|coolify|postgres|Callerzs)\b|I (ran|called) (the |a )?(tool|mcp)/i;

function assertNoInfraLeak(text) {
  if (INFRA_LEAK_RE.test(text)) {
    throw new Error(`operator copy leaked infra: ${text.slice(0, 280)}`);
  }
}
const SCENARIOS = [
  {
    id: 'S4',
    file: 'roofing-realistic-S4-dashboard.png',
    mode: 'dashboard',
    scrollStorm: true,
  },
  {
    id: 'E1',
    seat: 'rooferzs-integration',
    seatRe: /integration/i,
    file: 'roofing-realistic-E1-email-workflows.png',
    prompt:
      'What email follow-up workflows do we have for new storm leads? Use list_workflows and show a markdown table of names and status.',
    mustHave: [/workflow|GTM|draft|active/i, /\|.*\|/],
    inline: ['tool', 'table'],
  },
  {
    id: 'E2',
    seat: 'rooferzs-integration',
    seatRe: /integration/i,
    file: 'roofing-realistic-E2-email-campaign.png',
    prompt:
      'Start a post-inspection email drip for leads added this week in Dallas. Use create_workflow_from_preset or create_campaign — preview the plan in a table before confirm.',
    mustHave: [/campaign|workflow|drip|Dallas|draft/i],
    inline: ['tool', 'table'],
  },
  {
    id: 'E3',
    seat: 'rooferzs-integration',
    seatRe: /integration/i,
    file: 'roofing-realistic-E3-email-account-CHAT.png',
    prompt:
      'What sending domains and from-address branding do we have set up for Bluebonnet Peak Roofing work email? Show results in a table.',
    forbidInfra: true,
    mustHave: [/domain|brand|sending|mailbox|from/i],
    inline: ['tool', 'table'],
  },
  {
    id: 'E4',
    seat: 'rooferzs-integration',
    seatRe: /integration/i,
    file: 'roofing-realistic-E4-email-enroll-CHAT.png',
    prompt:
      'Enroll test lead door.knock.demo@mailinator.com in our active storm-lead welcome email sequence and confirm enrollment in a table.',
    forbidInfra: true,
    mustHave: [/enroll|workflow|door\.knock|confirm|mailinator/i],
    inline: ['tool', 'table'],
  },
  {
    id: 'E5',
    seat: 'rooferzs-integration',
    seatRe: /integration/i,
    file: 'roofing-realistic-E5-email-stats-CHAT.png',
    prompt:
      'How many emails did we send this week and what are open and click rates for Bluebonnet Peak Roofing? Show a small stats table.',
    forbidInfra: true,
    mustHave: [/email|sent|open|click|rate|\d/i],
    inline: ['tool', 'table'],
  },
  {
    id: 'S3',
    seat: 'rooferzs-integration',
    seatRe: /integration/i,
    file: 'roofing-realistic-S3-campaign-CHAT.png',
    prompt:
      'Set up an AI calling campaign for storm-lead follow-up in Dallas — preview script, agents, and call window in chat (no live calls).',
    forbidInfra: true,
    mustHave: [/campaign|script|agent|Dallas|09:00|window/i],
    inline: ['tool'],
  },
  {
    id: 'S1',
    seat: 'rooferzs-storm',
    seatRe: /storm/i,
    file: 'roofing-realistic-S1-storm.png',
    prompt:
      "What's the storm risk near Dallas this week? After checking storms, call custom_geolibre_map with features so I see the map inline.",
    mustHave: [/Dallas|storm|hail|Texas/i],
    inline: ['map', 'tool'],
  },
  {
    id: 'S2',
    seat: 'rooferzs-canvassing',
    seatRe: /canvassing/i,
    file: 'roofing-realistic-S2-canvass.png',
    prompt:
      'Suggest a door-knock route for hail-damaged blocks in Plano — numbered checklist of neighborhoods and call get_ops_map or custom_geolibre_map with pin features.',
    mustHave: [/Plano|canvass|door|checklist|route/i],
    inline: ['map', 'checklist'],
  },
  {
    id: 'S8',
    seat: 'rooferzs-project',
    seatRe: /project management/i,
    file: 'roofing-realistic-S8-dashboard-context-CHAT.png',
    forbidInfra: true,
    prompt:
      'Summarize what our dashboard storm section and KPI strip mean for the sales team today at Bluebonnet Peak Roofing.',
    mustHave: [/sales|storm|team|Bluebonnet|lead|today/i],
    inline: ['prose'],
  },
  {
    id: 'S4b',
    seat: 'rooferzs-project',
    seatRe: /project management/i,
    file: 'roofing-realistic-S4-stats-CHAT.png',
    forbidInfra: true,
    prompt:
      'How many leads did we add this week and what is pipeline value? Answer with a stats table matching dashboard KPIs.',
    mustHave: [/lead|pipeline|\$|week|\d/i],
    inline: ['table'],
  },
  {
    id: 'S5',
    seat: 'rooferzs-project',
    seatRe: /project management/i,
    file: 'roofing-realistic-S5-pipeline.png',
    prompt:
      'On our tenant jobs board (/dashboard/tenant-jobs), find the job at 1234 Main St, Plano TX. Use list_tenant_jobs then update_tenant_job_stage to move it to the inspection stage. Confirm the updated stage in a markdown table (job, address, stage key, stage label).',
    mustHave: [/inspection|1234|Main|Plano|stage|tenant.job|list_tenant_jobs/i],
    inline: ['table'],
  },
  {
    id: 'S6',
    seat: 'rooferzs-project',
    seatRe: /project management/i,
    file: 'roofing-realistic-S6-customer-doc.png',
    prompt:
      'Add this inspection note to customer Jordan Hale file: Hail damage on north slope — recommend full replacement. Search google-drive for Jordan Hale job folder and show the note saved or linked inline.',
    mustHave: [/Jordan|inspection|hail|note|folder|drive/i],
    inline: ['tool', 'prose'],
    optional: true,
  },
  {
    id: 'O+',
    seat: 'rooferzs-budget',
    seatRe: /budget/i,
    file: 'roofing-realistic-O-plus-CHAT.png',
    prompt:
      'Find ISOL or estimate documents for a Bluebonnet Peak Roofing Dallas hail job and show a selectable table before import.',
    forbidInfra: true,
    mustHave: [/ISOL|candidate|Bluebonnet|table|\|/i],
    inline: ['tool', 'table'],
  },
  {
    id: 'S7',
    seat: 'rooferzs-prospecting',
    seatRe: /prospecting/i,
    file: 'roofing-realistic-S7-phone-CHAT.png',
    prompt:
      'Give me the phone number for Jordan Hale at 1234 Main St Plano so I can call them — show it inline.',
    forbidInfra: true,
    mustHave: [/\(\d{3}\)|\d{3}[-.]?\d{3}[-.]?\d{4}|phone|555-1234/i],
    inline: ['phone'],
  },
];

const MP4 = path.join(MEDIA_DIR, 'roofing-realistic-S9-walkthrough-CHAT.mp4');
const SUMMARY = path.join(MEDIA_DIR, 'roofing-realistic-capture-summary.json');
const MCP_TURN_TIMEOUT_MS = Number(process.env.ROOFERZS_MCP_TURN_TIMEOUT_MS || 1_500_000);
const MAX_NETWORK_RESENDS = Number(process.env.ROOFERZS_CHAT_MAX_RESENDS || 1);
const NETWORK_ERROR_GRACE_MS = Number(process.env.ROOFERZS_NETWORK_ERROR_GRACE_MS || 180_000);

fs.mkdirSync(MEDIA_DIR, { recursive: true });
const videoDir = path.join(MEDIA_DIR, '_roofing-full-video');
fs.rmSync(videoDir, { recursive: true, force: true });
fs.mkdirSync(videoDir, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function composer(target) {
  const c = target.locator('textarea, [contenteditable="true"]').first();
  await c.waitFor({ timeout: 120_000 });
  return c;
}

async function ensureSidebarOpen(target) {
  const show = target.getByRole('button', { name: /show sidebar/i });
  if ((await show.count()) > 0 && (await show.isVisible())) {
    await show.click();
    await sleep(1500);
  }
}

/** Proof-in-chat: frame must be main transcript, not seat rail (workflows/proof-in-chat.md). */
async function collapseSidebarForProof(target) {
  const hide = target.getByRole('button', { name: /hide sidebar/i });
  if ((await hide.count()) > 0 && (await hide.isVisible())) {
    await hide.click();
    await sleep(1200);
  }
}

async function chatViewport(target) {
  const withMessages = target
    .locator('[data-slot="message-scroller-viewport"]')
    .filter({ has: target.locator('[data-slot="message"]') });
  const vp =
    (await withMessages.count()) > 0
      ? withMessages.first()
      : target.locator('[data-slot="message-scroller-viewport"]').first();
  await vp.waitFor({ state: 'visible', timeout: 120_000 });
  const box = await vp.boundingBox();
  if (!box || box.width < 280) {
    await collapseSidebarForProof(target);
    await sleep(800);
    const box2 = await vp.boundingBox();
    if (!box2 || box2.width < 280) {
      throw new Error(`chat viewport too narrow (${box2?.width ?? 0}px)`);
    }
  }
  return vp;
}

/** DOM proof per workflows/proof-in-chat.md — not seat rail only. */
async function assertAssistantInlineDom(target, prompt) {
  const result = await target.evaluate((promptNeedle) => {
    const messages = [...document.querySelectorAll('[data-slot="message"]')];
    if (messages.length < 2) return { ok: false, reason: 'too_few_messages' };

    const needle = promptNeedle.slice(0, 48);
    let userIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].innerText.includes(needle)) {
        userIdx = i;
        break;
      }
    }
    if (userIdx < 0) return { ok: false, reason: 'user_prompt_missing' };

    const userEl = messages[userIdx];
    const vp = document.querySelector('[data-slot="message-scroller-viewport"]');
    const vpBox = vp?.getBoundingClientRect();
    const userBox = userEl?.getBoundingClientRect();
    if (vpBox && userBox && (userBox.top < vpBox.top - 8 || userBox.bottom > vpBox.bottom + 8)) {
      return { ok: false, reason: 'user_prompt_not_in_viewport' };
    }
    if (vpBox && vpBox.width < 200) return { ok: false, reason: 'viewport_too_narrow' };

    const seatInScroller =
      vp &&
      [...document.querySelectorAll('[data-seat-id]')].some((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 40 && r.left >= vpBox.left - 4 && r.right <= vpBox.right + 4;
      });
    if (seatInScroller) return { ok: false, reason: 'seat_rail_in_chat_frame' };

    const scan = (root) => {
      const text = root.innerText || '';
      const hasTable =
        !!root.querySelector('table') ||
        (/\|.+\|/.test(text) && text.split('\n').some((l) => /^\s*\|/.test(l)));
      const hasList =
        !!root.querySelector('ol, ul') ||
        /^\s*\d+\.\s+\S/m.test(text) ||
        /^\s*[-*]\s+\S/m.test(text);
      const hasMap =
        !!root.querySelector(
          'canvas, .maplibregl-canvas, .maplibregl-map, iframe[src*="blob"], iframe[title]',
        ) || /maplibre|geolibre|storm map/i.test(text);
      const hasTool =
        !!root.querySelector('details summary') ||
        /list_workflows|create_campaign|create_workflow|get_ops_map|custom_geolibre/i.test(text);
      const hasIntel =
        !!root.querySelector('[data-testid^="component-"]') ||
        !!root.querySelector('iframe') ||
        /intel-attachment|checklist|showRecord/i.test(text);
      return { hasTable, hasList, hasMap, hasTool, hasIntel, textLen: text.length };
    };

    for (let i = userIdx + 1; i < messages.length; i++) {
      const align = messages[i].getAttribute('data-align');
      if (align === 'end') continue;
      const content = messages[i].querySelector('[data-slot="message-content"]') || messages[i];
      const flags = scan(content);
      const anyInline =
        flags.hasTable ||
        flags.hasList ||
        flags.hasMap ||
        flags.hasTool ||
        flags.hasIntel ||
        flags.textLen > 180;
      if (anyInline) return { ok: true, flags, messageIndex: i };
    }
    return { ok: false, reason: 'no_assistant_inline_evidence' };
  }, prompt);

  if (!result.ok) {
    throw new Error(`assistant inline DOM check failed: ${JSON.stringify(result)}`);
  }
  return result;
}

async function scrollChatProofIntoView(target, prompt) {
  const messages = target.locator('[data-slot="message"]');
  await messages.first().waitFor({ state: 'visible', timeout: 120_000 });
  const count = await messages.count();
  const needle = prompt.slice(0, 50);
  let userIdx = -1;
  for (let i = count - 1; i >= 0; i--) {
    const align = await messages.nth(i).getAttribute('data-align');
    const body = await messages.nth(i).innerText();
    if (body.includes(needle) && align === 'end') {
      userIdx = i;
      break;
    }
  }
  const vp = await chatViewport(target);
  if (userIdx >= 0) {
    await vp.evaluate((el, idx) => {
      const msg = document.querySelectorAll('[data-slot="message"]')[idx];
      if (!msg) return;
      const top = msg.offsetTop - 24;
      el.scrollTop = Math.max(0, top);
    }, userIdx);
    await sleep(700);
  } else if (count > 0) {
    await messages.nth(count - 1).scrollIntoViewIfNeeded();
    await sleep(600);
  }
  return { userIdx, messageCount: count };
}

async function screenshotChatProof(target, outPath, prompt, mustHave) {
  await collapseSidebarForProof(target);
  await scrollChatProofIntoView(target, prompt);
  const messages = target.locator('[data-slot="message"]');
  const count = await messages.count();
  const needle = prompt.slice(0, 40);
  let tail = '';
  let sawUser = false;
  for (let i = Math.max(0, count - 6); i < count; i++) {
    const body = await messages.nth(i).innerText();
    if (body.includes(needle)) sawUser = true;
    tail += `\n${body}`;
  }
  if (!sawUser || !mustHave.every((re) => re.test(tail))) {
    throw new Error('chat proof frame missing user prompt and/or expected assistant text');
  }
  await assertAssistantInlineDom(target, prompt);
  const vp = await chatViewport(target);
  await vp.screenshot({ path: outPath });
}

async function selectSeat(target, seatId, labelRe) {
  await ensureSidebarOpen(target);
  const byId = target.locator(`[data-seat-id="${seatId}"]`).first();
  if ((await byId.count()) > 0) await byId.click({ timeout: 60_000 });
  else await target.getByRole('button', { name: labelRe }).first().click({ timeout: 60_000 });
  await sleep(4000);
}

function hasInlineRichness(text, kinds) {
  const hasTool = /list_workflows|list_scripts|TOOL|tool call|mcp__/i.test(text) ||
    targetHasToolCard(text);
  const hasTable = /\|.+\|/.test(text) || /<table/i.test(text);
  const hasMap = /custom_geolibre|maplibre|Storm Watch|iframe|geolibre/i.test(text);
  const hasPhone = /\(\d{3}\)\s*\d{3}[- ]?\d{4}|\d{3}-\d{3}-\d{4}/.test(text);
  const ok = {
    tool: hasTool,
    table: hasTable,
    map: hasMap,
    checklist: /1\.|checklist|priority/i.test(text),
    phone: hasPhone,
    prose: text.length > 200,
  };
  return kinds.every((k) => ok[k] !== false && (ok[k] === true || k === 'prose'));
}

function targetHasToolCard(text) {
  return /mcp-emailzs|mcp-callerzs|mcp-rooferzs|list_workflows|create_campaign/i.test(text);
}

async function isMcpTurnBusy(target) {
  return target.evaluate(() => {
    const body = document.body?.innerText ?? '';
    if (/\bThinking\b/i.test(body)) return true;
    if (document.querySelector('.tool-line-running')) return true;
    const summaries = document.querySelectorAll('details.tool-line summary');
    for (const s of summaries) {
      const t = s.textContent ?? '';
      if (/mcp-emailzs|list_workflows|create_workflow|create_campaign/i.test(t)) return true;
    }
    return false;
  });
}

async function resendPrompt(target, prompt) {
  const c = await composer(target);
  await c.fill(prompt);
  await c.press('Enter');
}

async function freshChatThread(page) {
  const btn = page.getByRole('button', { name: /^New chat$/i });
  if ((await btn.count()) > 0 && (await btn.isVisible())) {
    await btn.click();
    await sleep(2500);
    return;
  }
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('openbot.bot-thread.')) localStorage.removeItem(k);
    }
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(4000);
  await page.locator('textarea, [contenteditable="true"]').first().waitFor({ timeout: 120_000 });
}

async function waitForRichTurn(
  target,
  pageRef,
  prompt,
  mustHave,
  inlineKinds,
  timeoutMs = MCP_TURN_TIMEOUT_MS,
  forbidInfra = false,
) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  let resendCount = 0;
  let networkErrorSince = 0;
  while (Date.now() < deadline) {
    try {
      last = await target.locator('body').innerText();
    } catch (err) {
      if (/closed/i.test(String(err))) throw new Error('browser page closed during MCP turn');
      throw err;
    }
    const thinking = /\bThinking\b/i.test(last);
    const mcpBusy = await isMcpTurnBusy(target);
    const afterPrompt = (() => {
      const idx = last.lastIndexOf(prompt.slice(0, 40));
      return idx >= 0 ? last.slice(idx) : last;
    })();
    if (/network error/i.test(afterPrompt) && !thinking && !mcpBusy) {
      const recovered = await assertAssistantInlineDom(target, prompt).catch(() => null);
      if (!recovered?.ok) {
        if (!networkErrorSince) networkErrorSince = Date.now();
        const graceElapsed = Date.now() - networkErrorSince;
        if (graceElapsed >= NETWORK_ERROR_GRACE_MS && resendCount < MAX_NETWORK_RESENDS) {
          resendCount += 1;
          networkErrorSince = 0;
          if (pageRef) await freshChatThread(pageRef);
          await resendPrompt(target, prompt);
          await sleep(10_000);
          continue;
        }
        if (graceElapsed >= NETWORK_ERROR_GRACE_MS + 120_000) {
          throw new Error('network error in chat (SSE/MCP idle)');
        }
        await sleep(8000);
        continue;
      }
    } else {
      networkErrorSince = 0;
    }
    if (mcpBusy || thinking) {
      await sleep(4000);
      continue;
    }
    const idx = last.lastIndexOf(prompt.slice(0, 40));
    const after = idx >= 0 ? last.slice(idx) : last;
    const domOk = await assertAssistantInlineDom(target, prompt).catch(() => null);
    const richOk = hasInlineRichness(after, inlineKinds);
    if (mustHave.every((re) => re.test(after)) && richOk && (domOk?.ok || richOk)) {
      if (forbidInfra) assertNoInfraLeak(after);
      return { text: last, excerpt: after.slice(0, 800), dom: domOk ?? { ok: true } };
    }
    await sleep(4000);
  }
  throw new Error(`timeout scenario; tail=${last.slice(-600)}`);
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

function agentLaunchUrl() {
  const url = execSync('cd /root/devvy/projects/vibezs-runner && npx tsx scripts/gen-launch-url.ts', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  if (!url.startsWith('https://')) throw new Error(`bad launch url: ${url}`);
  return url;
}

/** Standalone agent surface — wide chat column; embed iframe crops to seat rail. */
async function openAgent(page) {
  const url = agentLaunchUrl();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await sleep(8000);
  await page.locator('textarea, [contenteditable="true"]').first().waitFor({ timeout: 120_000 });
  return page;
}

const meta = { tenant: TENANT, scenarios: {}, ok: false, errors: [] };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
let agentTarget = null;

try {
  await login(page);

  let skipping = Boolean(SKIP_UNTIL);
  for (const sc of SCENARIOS) {
    if (ONLY_IDS && !ONLY_IDS.includes(sc.id)) continue;
    if (skipping) {
      if (sc.id === SKIP_UNTIL) skipping = false;
      else continue;
    }
    const outPath = path.join(MEDIA_DIR, sc.file);
    if (fs.existsSync(outPath) && process.env.ROOFERZS_REUSE_SCREENSHOTS === '1') {
      meta.scenarios[sc.id] = { ok: true, file: sc.file, reused: true };
      continue;
    }
    if (sc.mode === 'dashboard') {
      await page.goto(`https://app.rooferzs.com/${TENANT}/dashboard/dynamic`, {
        waitUntil: 'networkidle',
        timeout: 120_000,
      });
      await sleep(8000);
      if (sc.scrollStorm) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.55));
        await sleep(2000);
      }
      await page.screenshot({ path: path.join(MEDIA_DIR, sc.file), fullPage: false });
      meta.scenarios[sc.id] = { ok: true, file: sc.file };
      continue;
    }

    if (!agentTarget) agentTarget = await openAgent(page);
    await selectSeat(agentTarget, sc.seat, sc.seatRe);
    const c = await composer(agentTarget);
    await c.fill(sc.prompt);
    await c.press('Enter');
    try {
      const result = await waitForRichTurn(
        agentTarget,
        page,
        sc.prompt,
        sc.mustHave,
        sc.inline,
        undefined,
        sc.forbidInfra === true,
      );
      const dom = await screenshotChatProof(
        agentTarget,
        path.join(MEDIA_DIR, sc.file),
        sc.prompt,
        sc.mustHave,
      );
      meta.scenarios[sc.id] = {
        ok: true,
        file: sc.file,
        prompt: sc.prompt,
        excerpt: result.excerpt.slice(0, 500),
        inline: sc.inline,
        dom,
        surface: 'standalone-agent',
      };
    } catch (turnErr) {
      await screenshotChatProof(agentTarget, path.join(MEDIA_DIR, sc.file), sc.prompt, sc.mustHave).catch(
        () =>
          agentTarget
            .locator('[data-slot="message-scroller-viewport"]')
            .first()
            .screenshot({ path: path.join(MEDIA_DIR, sc.file) })
            .catch(() => {}),
      );
      if (sc.optional) {
        meta.scenarios[sc.id] = {
          ok: false,
          optional: true,
          file: sc.file,
          error: String(turnErr.message || turnErr),
        };
      } else {
        throw turnErr;
      }
    }
    await sleep(2000);
  }
  meta.ok = Object.entries(meta.scenarios).every(([id, s]) => {
    const sc = SCENARIOS.find((x) => x.id === id);
    if (sc?.optional && !s.ok) return true;
    return s.ok;
  });
} catch (e) {
  meta.errors.push(String(e.message || e));
  if (agentTarget) {
    await agentTarget
      .locator('[data-slot="message-scroller-viewport"]')
      .first()
      .screenshot({ path: path.join(MEDIA_DIR, 'roofing-realistic-capture-failure.png') })
      .catch(() => {});
  } else {
    await page
      .screenshot({ path: path.join(MEDIA_DIR, 'roofing-realistic-capture-failure.png') })
      .catch(() => {});
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
fs.writeFileSync(SUMMARY, JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
process.exit(meta.ok ? 0 : 1);
