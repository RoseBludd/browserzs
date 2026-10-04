/**
 * Proof-in-chat recapture — bluebonnetpeakroofing app embed.
 * Frames the message scroller (not seat rail). DOM-validates inline assistant evidence before save.
 *
 * One Chromium launch and one tenant login per process; scenarios run in the same browser context/page.
 *
 * Environment:
 *   ROOFERZS_MEDIA_DIR          — PNG/webm output dir (default: this agent's Project store …/media)
 *   ROOFERZS_SCENARIOS          — Comma IDs to run (e.g. E1,E2,S1); default = full chat matrix
 *   ROOFERZS_CHAT_ONLY          — Deprecated alias for ROOFERZS_SCENARIOS
 *   ROOFERZS_CHAT_INCLUDE_S1S2  — Set to 1 to include S1/S2 storm+canvass in default matrix
 *   ROOFERZS_CHAT_INCLUDE_S5    — Set to 0 to skip S5 after E1/E2 coordinator gate (default: run when ready)
 *   ROOFERZS_CHAT_SURFACE       — full-panel | embed | standalone (default: full-panel)
 *   ROOFERZS_CLIP_PER_SCENARIO  — Set to 1 to write a short .webm per passed scenario (same session)
 *   ROOFERZS_MCP_TURN_TIMEOUT_MS — Max wait per assistant turn (default: 1500000)
 *   ROOFERZS_CHAT_MAX_RESENDS   — Network-error resend cap (default: 1)
 *   ROOFERZS_NETWORK_ERROR_GRACE_MS — Grace before resend on network error (default: 180000)
 *   ROOFERZS_CHAT_LANE            — email | field — preset scenario order when ROOFERZS_SCENARIOS unset
 */
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const MEDIA_DIR =
  process.env.ROOFERZS_MEDIA_DIR?.trim() ||
  '/root/.local/state/cursor/agent-stores/cursor_agent_stores/bc-49d94244-10a5-4a36-a7e1-22be46f6c8c8/files/media';

const TENANT = 'bluebonnetpeakroofing';
const EMAIL = 'jordan.hale+restart1790915600@mailinator.com';
const PASSWORD = 'RESTORE';

const CHAT_LANE = process.env.ROOFERZS_CHAT_LANE?.trim()?.toLowerCase() || '';
const INCLUDE_STORM_CANVASS =
  process.env.ROOFERZS_CHAT_INCLUDE_S1S2 === '1' || CHAT_LANE === 'field';
const INCLUDE_S5_AFTER_E1E2 = process.env.ROOFERZS_CHAT_INCLUDE_S5 !== '0';
/** embed iframe is ~560px → mobile rail-only; use Full agent tab for proof-in-chat framing */
const CHAT_SURFACE = process.env.ROOFERZS_CHAT_SURFACE?.trim() || 'full-panel';
const CLIP_PER_SCENARIO = process.env.ROOFERZS_CLIP_PER_SCENARIO === '1';

function scenarioIdsFromEnv() {
  const raw =
    process.env.ROOFERZS_SCENARIOS?.trim() || process.env.ROOFERZS_CHAT_ONLY?.trim() || '';
  if (!raw) return null;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const SCENARIO_FILTER = scenarioIdsFromEnv();

const LANE_SCENARIO_ORDER = {
  email: ['E1', 'E2', 'E5', 'E4', 'E3'],
  field: ['S1', 'S2', 'S7', 'S3', 'S4b', 'O+'],
};

const SCENARIOS = [
  {
    id: 'E1',
    seat: 'rooferzs-integration',
    seatRe: /integration/i,
    file: 'roofing-realistic-E1-email-workflows-CHAT.png',
    prompt:
      'What email follow-up workflows do we have for new storm leads? Show workflow names and status in a table for Bluebonnet Peak Roofing.',
    mustHave: [/workflow|follow-up|campaign|set up|don't have|no email|storm lead/i],
    forbidInfra: true,
    inline: [],
  },
  {
    id: 'E2',
    seat: 'rooferzs-integration',
    seatRe: /integration/i,
    file: 'roofing-realistic-E2-email-campaign-CHAT.png',
    prompt:
      'Draft a 4-step post-inspection email drip for Dallas hail leads added this week. Show step number, delay, and subject line in a table with realistic roofing copy.',
    mustHave: [/post-inspection|drip|Dallas|step|email|subject/i],
    forbidInfra: true,
    inline: ['table'],
  },
  {
    id: 'E3',
    seat: 'rooferzs-integration',
    seatRe: /integration/i,
    file: 'roofing-realistic-E3-email-account-CHAT.png',
    prompt:
      'What sending domains and from-address branding do we have set up for Bluebonnet Peak Roofing work email? Show results in a table.',
    mustHave: [/domain|brand|sending|mailbox|from/i],
    forbidInfra: true,
    inline: ['table'],
  },
  {
    id: 'E4',
    seat: 'rooferzs-integration',
    seatRe: /integration/i,
    file: 'roofing-realistic-E4-email-enroll-CHAT.png',
    prompt:
      'Enroll test lead door.knock.demo@mailinator.com in our active storm-lead welcome email sequence and confirm enrollment in a table.',
    mustHave: [/enroll|workflow|door\.knock|confirm|mailinator/i],
    forbidInfra: true,
    inline: ['table'],
  },
  {
    id: 'E5',
    seat: 'rooferzs-integration',
    seatRe: /integration/i,
    file: 'roofing-realistic-E5-email-stats-CHAT.png',
    prompt:
      'How many emails did we send this week and what are open and click rates for Bluebonnet Peak Roofing? Show a small stats table.',
    mustHave: [/email|sent|open|click|rate|\d/i],
    forbidInfra: true,
    inline: ['table'],
  },
  {
    id: 'S3',
    seat: 'rooferzs-integration',
    seatRe: /integration/i,
    file: 'roofing-realistic-S3-campaign-CHAT.png',
    prompt:
      'Set up an AI calling campaign for storm-lead follow-up in Dallas — preview script, agents, and call window in chat (no live calls).',
    mustHave: [/campaign|script|agent|Dallas|09:00|window/i],
    forbidInfra: true,
    inline: ['tool'],
  },
  {
    id: 'S4b',
    seat: 'rooferzs-project',
    seatRe: /project management/i,
    file: 'roofing-realistic-S4-stats-CHAT.png',
    prompt:
      'How many leads did we add this week and what is pipeline value? Answer with a stats table matching dashboard KPIs.',
    mustHave: [/lead|pipeline|\$|week|\d/i],
    forbidInfra: true,
    inline: ['table'],
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
  {
    id: 'O+',
    seat: 'rooferzs-budget',
    seatRe: /budget/i,
    file: 'roofing-realistic-O-plus-CHAT.png',
    prompt:
      'Find ISOL or estimate documents for a Bluebonnet Peak Roofing Dallas hail job and show a selectable table before import.',
    forbidInfra: true,
    mustHave: [/ISOL|candidate|Bluebonnet|table|\|/i],
    inline: ['table'],
  },
];

const S5_SCENARIO = {
  id: 'S5',
  seat: 'rooferzs-project',
  seatRe: /project management/i,
  file: 'roofing-realistic-S5-pipeline-CHAT.png',
  prompt:
    'On our jobs board, find the job at 1234 Main St, Plano TX and move it to the inspection stage. Confirm with a table: job name, address, stage.',
  mustHave: [/inspection|1234|Main|Plano|stage/i],
  forbidInfra: true,
  inline: ['table'],
  requiresCoordinatorReady: true,
};

if (INCLUDE_STORM_CANVASS) {
  SCENARIOS.push(
    {
      id: 'S1',
      seat: 'rooferzs-storm',
      seatRe: /storm/i,
      file: 'roofing-realistic-S1-storm-CHAT.png',
      prompt:
        "What's the storm risk near Dallas this week? Show the outlook and storm map inline for Bluebonnet Peak Roofing.",
      mustHave: [/Dallas|storm|hail|Texas/i],
      inline: ['map'],
    },
    {
      id: 'S2',
      seat: 'rooferzs-canvassing',
      seatRe: /canvassing/i,
      file: 'roofing-realistic-S2-canvass-CHAT.png',
      prompt:
        'Suggest a door-knock route for hail-damaged blocks in Plano — numbered checklist of neighborhoods and show pins on the map inline.',
      mustHave: [/Plano|canvass|door|checklist|route/i],
      inline: ['checklist'],
    },
  );
}

const SUMMARY = path.join(MEDIA_DIR, 'roofing-proof-in-chat-summary.json');
const INTERNAL_FAIL_DIR = path.join(
  path.dirname(MEDIA_DIR),
  'internal',
  'capture-failures',
);
const MCP_TURN_TIMEOUT_MS = Number(process.env.ROOFERZS_MCP_TURN_TIMEOUT_MS || 1_500_000);
const MAX_NETWORK_RESENDS = Number(process.env.ROOFERZS_CHAT_MAX_RESENDS || 1);
const NETWORK_ERROR_GRACE_MS = Number(process.env.ROOFERZS_NETWORK_ERROR_GRACE_MS || 180_000);
const INFRA_LEAK_RE =
  /\b(mcp[-_]|list_workflows|list_campaigns|enroll_lead_in_workflow|emailzs\.com|geniuzs\.com|maps\.geniuzs|coolify|postgres)\b|I (ran|called) (the |a )?(tool|mcp)/i;

function assertNoInfraLeak(text) {
  if (INFRA_LEAK_RE.test(text)) {
    throw new Error(`operator copy leaked infra: ${text.slice(0, 280)}`);
  }
}

fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(INTERNAL_FAIL_DIR, { recursive: true });

const REQUIRED_CHAT_FILES = [
  'roofing-realistic-E1-email-workflows-CHAT.png',
  'roofing-realistic-E2-email-campaign-CHAT.png',
];

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

async function collapseSidebarForProof(target) {
  const hide = target.getByRole('button', { name: /hide sidebar/i });
  if ((await hide.count()) > 0 && (await hide.isVisible())) {
    await hide.click();
    await sleep(1200);
  }
}

async function chatViewport(target) {
  const vp = target.locator('[data-slot="message-scroller-viewport"]').first();
  await vp.waitFor({ state: 'visible', timeout: 120_000 });
  return vp;
}

async function scrollChatProofIntoView(target, prompt) {
  const messages = target.locator('[data-slot="message"]');
  await messages.first().waitFor({ state: 'visible', timeout: 120_000 });
  const count = await messages.count();
  const needle = prompt.slice(0, 50);
  let userIdx = -1;
  for (let i = count - 1; i >= 0; i--) {
    const body = await messages.nth(i).innerText();
    if (body.includes(needle)) {
      userIdx = i;
      break;
    }
  }
  const vp = await chatViewport(target);
  if (userIdx >= 0) await messages.nth(userIdx).scrollIntoViewIfNeeded();
  if (count > 0) await messages.nth(count - 1).scrollIntoViewIfNeeded();
  await sleep(600);
  await vp.evaluate((el) => {
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - 48);
  });
  await sleep(500);
}

function inlineKindsSatisfied(flags, kinds) {
  const map = {
    table: flags.hasTable,
    list: flags.hasList,
    map: flags.hasMap,
    tool: flags.hasTool,
    phone:
      flags.hasPhone ||
      /\(\d{3}\)\s*\d{3}[-.]?\d{4}|\d{3}[-.]?\d{3}[-.]?\d{4}/.test(flags.textSample || ''),
    checklist: flags.hasList || /checklist|priority|neighborhood/i.test(flags.textSample || ''),
  };
  return kinds.every((k) => map[k] === true);
}

/** DOM proof: assistant turn after user prompt has table/list/map/tool/intel — not rail-only. */
async function assertAssistantInlineDom(target, prompt, inlineKinds = []) {
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

    const vp = document.querySelector('[data-slot="message-scroller-viewport"]');
    const vpBox = vp?.getBoundingClientRect();
    if (vpBox && vpBox.width < 200) return { ok: false, reason: 'viewport_too_narrow' };

    // Seat rail may sit beside the scroller in full-panel mode; proof PNG crops the scroller only.

    const scan = (root) => {
      const text = root.innerText || '';
      const hasTable =
        !!root.querySelector('table') ||
        (/\|.+\|/.test(text) && text.split('\n').some((l) => /^\s*\|/.test(l))) ||
        (/\bworkflow name\b/i.test(text) && /\t/.test(text) && /\bstatus\b/i.test(text));
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
        /list_workflows|create_campaign|create_workflow|get_ops_map|custom_geolibre|list_tenant_jobs|update_tenant_job/i.test(
          text,
        );
      const hasIntel =
        !!root.querySelector('[data-testid^="component-"]') ||
        !!root.querySelector('iframe') ||
        /intel-attachment|checklist|showRecord/i.test(text);
      const hasPhone =
        /\(\d{3}\)\s*\d{3}[-.]?\d{4}/.test(text) ||
        /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/.test(text);
      return {
        hasTable,
        hasList,
        hasMap,
        hasTool,
        hasIntel,
        hasPhone,
        textLen: text.length,
        textSample: text.slice(0, 400),
      };
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
        flags.hasPhone ||
        flags.textLen > 180;
      if (anyInline) {
        return { ok: true, flags, messageIndex: i };
      }
    }
    return { ok: false, reason: 'no_assistant_inline_evidence' };
  }, prompt);

  if (result.ok && inlineKinds.length > 0 && !inlineKindsSatisfied(result.flags, inlineKinds)) {
    throw new Error(`inline kinds not met: ${JSON.stringify({ need: inlineKinds, flags: result.flags })}`);
  }

  if (!result.ok) {
    throw new Error(`assistant inline DOM check failed: ${JSON.stringify(result)}`);
  }
  return result;
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

let cachedFullHref = null;

async function resolveFullAgentHref(page) {
  if (cachedFullHref) return cachedFullHref;
  await page.goto(`https://app.rooferzs.com/${TENANT}/dashboard/dynamic`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  await sleep(4000);
  await page.getByRole('button', { name: /open agent/i }).click({ timeout: 30_000 });
  await sleep(2000);
  const panel = page.locator('aside[aria-label="Tenant agent"]');
  await panel.waitFor({ state: 'visible', timeout: 30_000 });
  cachedFullHref = await panel.locator('a[title="Open full agent"]').getAttribute('href');
  if (!cachedFullHref?.includes('agent.rooferzs.com')) {
    throw new Error(`missing standalone agent href (got ${cachedFullHref ?? 'null'})`);
  }
  return cachedFullHref;
}

async function openFullPanelAgent(page) {
  const fullHref = await resolveFullAgentHref(page);
  await page.goto(fullHref, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await sleep(5000);
  await page.locator('textarea, [contenteditable="true"]').first().waitFor({ timeout: 120_000 });
  return page;
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
  let networkErrorStreak = 0;
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
      const recovered = await assertAssistantInlineDom(target, prompt, inlineKinds).catch(() => null);
      if (!recovered?.ok) {
        if (!networkErrorSince) networkErrorSince = Date.now();
        networkErrorStreak += 1;
        const graceElapsed = Date.now() - networkErrorSince;
        if (graceElapsed >= NETWORK_ERROR_GRACE_MS && resendCount < MAX_NETWORK_RESENDS) {
          resendCount += 1;
          networkErrorStreak = 0;
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
      networkErrorStreak = 0;
      await sleep(4000);
      continue;
    }
    networkErrorStreak = 0;
    const idx = last.lastIndexOf(prompt.slice(0, 40));
    const after = idx >= 0 ? last.slice(idx) : last;
    await collapseSidebarForProof(target);
    const dom = await assertAssistantInlineDom(target, prompt, inlineKinds).catch(() => null);
    const proseEmptyState =
      /\bfollow-up\b/i.test(after) &&
      (/\bno\b|\byet\b|set up|don't have|enrolled|built-in/i.test(after) || after.length > 220);
    const tableInBody =
      proseEmptyState ||
      (/\bworkflow\b/i.test(after) && /\t/.test(after) && /\b(active|draft|status|trigger)\b/i.test(after)) ||
      (/\bstep\b/i.test(after) &&
        /\bdelay\b/i.test(after) &&
        /\bemail subject\b/i.test(after) &&
        /\b\d+\s+/.test(after)) ||
      (/1234|Main St|inspection/i.test(after) &&
        /\b(stage|job)\b/i.test(after) &&
        (/\t/.test(after) || /\bJ-\d+/i.test(after) || /stage key/i.test(after)));
    if (mustHave.every((re) => re.test(after)) && (dom?.ok || tableInBody)) {
      if (forbidInfra) assertNoInfraLeak(after);
      return {
        text: last,
        excerpt: after.slice(0, 800),
        dom: dom?.ok ? dom : { ok: true, flags: { hasTable: true, textSample: after.slice(0, 200) } },
      };
    }
    await sleep(4000);
  }
  throw new Error(`timeout scenario; tail=${last.slice(-600)}`);
}

async function screenshotChatProof(target, outPath, prompt, inlineKinds = []) {
  await collapseSidebarForProof(target);
  await scrollChatProofIntoView(target, prompt);
  let dom = await assertAssistantInlineDom(target, prompt, inlineKinds).catch(() => null);
  if (!dom?.ok) {
    const body = await target.locator('body').innerText();
    const idx = body.lastIndexOf(prompt.slice(0, 40));
    const after = idx >= 0 ? body.slice(idx) : body;
    if (
      (/\bworkflow\b/i.test(after) && /\t/.test(after) && /\b(active|draft|status|trigger)\b/i.test(after)) ||
      (/\bstep\b/i.test(after) &&
        /\bdelay\b/i.test(after) &&
        /\bemail subject\b/i.test(after) &&
        /\b\d+\s+/.test(after)) ||
      (/stage key/i.test(after) && /inspection/i.test(after) && /1234|Main St/i.test(after))
    ) {
      dom = { ok: true, flags: { hasTable: true, textSample: after.slice(0, 200) } };
    } else {
      throw new Error(`assistant inline DOM check failed: ${JSON.stringify(dom)}`);
    }
  }
  const vp = await chatViewport(target);
  await vp.screenshot({ path: outPath });
  return dom;
}

async function selectSeat(target, seatId, labelRe) {
  await ensureSidebarOpen(target);
  const byId = target.locator(`[data-seat-id="${seatId}"]`).first();
  if ((await byId.count()) > 0) await byId.click({ timeout: 60_000 });
  else await target.getByRole('button', { name: labelRe }).first().click({ timeout: 60_000 });
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

async function openEmbedAgent(page) {
  await page.goto(`https://app.rooferzs.com/${TENANT}/dashboard/dynamic`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await sleep(6000);
  await page.getByRole('button', { name: /open agent/i }).click({ timeout: 30_000 });
  await sleep(2500);
  const iframe = page.frameLocator('iframe[title="OpenBot roofing agent"]');
  await iframe.locator('textarea, [contenteditable="true"]').first().waitFor({ timeout: 120_000 });
  return iframe;
}

async function createClipRecorder(page) {
  const client = await page.context().newCDPSession(page);
  const frames = [];
  const handler = async (payload) => {
    frames.push(Buffer.from(payload.data, 'base64'));
    await client.send('Page.screencastFrameAck', { sessionId: payload.sessionId }).catch(() => {});
  };
  client.on('Page.screencastFrame', handler);
  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 75,
    maxWidth: 1280,
    maxHeight: 720,
    everyNthFrame: 2,
  });
  return {
    async stop(outPath) {
      await client.send('Page.stopScreencast').catch(() => {});
      client.removeListener('Page.screencastFrame', handler);
      if (frames.length < 2) return false;
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roof-chat-clip-'));
      try {
        frames.forEach((buf, i) =>
          fs.writeFileSync(path.join(tmpDir, `f${String(i).padStart(5, '0')}.jpg`), buf),
        );
        execSync(
          `ffmpeg -y -framerate 4 -i "${tmpDir}/f%05d.jpg" -c:v libvpx-vp9 -b:v 600k -an "${outPath}"`,
          { stdio: 'pipe' },
        );
        return fs.existsSync(outPath);
      } catch {
        return false;
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  };
}

function orderScenariosByIds(scenarios, ids) {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  if (!ids?.length) return scenarios;
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function buildRunList() {
  let list;
  if (SCENARIO_FILTER?.length) {
    list = orderScenariosByIds(SCENARIOS, SCENARIO_FILTER);
  } else if (CHAT_LANE && LANE_SCENARIO_ORDER[CHAT_LANE]) {
    list = orderScenariosByIds(SCENARIOS, LANE_SCENARIO_ORDER[CHAT_LANE]);
  } else {
    list = [...SCENARIOS];
  }
  const wantS5 =
    INCLUDE_S5_AFTER_E1E2 && (!SCENARIO_FILTER || SCENARIO_FILTER.includes('S5'));
  if (wantS5 && !list.some((s) => s.id === 'S5')) {
    list = [...list, S5_SCENARIO];
  }
  return list;
}

async function runScenarioInSession(page, chatTarget, sc, meta) {
  const outPath = path.join(MEDIA_DIR, sc.file);
  let clipRecorder = null;
  try {
    await freshChatThread(page);
    await selectSeat(chatTarget, sc.seat, sc.seatRe);
    const c = await composer(chatTarget);
    if (CLIP_PER_SCENARIO) {
      clipRecorder = await createClipRecorder(page);
    }
    await c.fill(sc.prompt);
    await c.press('Enter');
    const turn = await waitForRichTurn(
      chatTarget,
      page,
      sc.prompt,
      sc.mustHave,
      sc.inline,
      undefined,
      sc.forbidInfra === true,
    );
    const dom = await screenshotChatProof(chatTarget, outPath, sc.prompt, sc.inline);
    publishPass(outPath, sc.id);
    const scenarioMeta = {
      ok: true,
      file: sc.file,
      path: outPath,
      dom,
      excerpt: turn.excerpt.slice(0, 400),
    };
    if (clipRecorder) {
      const webmPath = outPath.replace(/\.png$/i, '.webm');
      if (await clipRecorder.stop(webmPath)) {
        scenarioMeta.clip = webmPath;
      }
      clipRecorder = null;
    }
    meta.scenarios[sc.id] = scenarioMeta;
    meta.passedPaths.push(outPath);
    return true;
  } catch (e) {
    const failPath = path.join(INTERNAL_FAIL_DIR, sc.file.replace('.png', '-FAILED.png'));
    await chatTarget
      ?.locator('[data-slot="message-scroller-viewport"]')
      .first()
      .screenshot({ path: failPath })
      .catch(() => {});
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    meta.scenarios[sc.id] = {
      ok: false,
      file: sc.file,
      error: String(e.message || e),
      debugScreenshot: failPath,
    };
    meta.errors.push(`${sc.id}: ${e.message || e}`);
    return false;
  } finally {
    if (clipRecorder) {
      await clipRecorder.stop(path.join(MEDIA_DIR, `.clip-abort-${sc.id}.webm`)).catch(() => {});
    }
  }
}

async function openChatTarget(page) {
  if (CHAT_SURFACE === 'embed') {
    return { target: await openEmbedAgent(page), surface: 'app-embed-iframe' };
  }
  if (CHAT_SURFACE === 'standalone') {
    const { execSync } = await import('child_process');
    const url = execSync(
      'cd /root/devvy/projects/vibezs-runner && node --import tsx scripts/gen-launch-url.ts',
      { encoding: 'utf8' },
    ).trim();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await sleep(5000);
    await page.locator('textarea, [contenteditable="true"]').first().waitFor({ timeout: 120_000 });
    return { target: page, surface: 'agent.rooferzs.com-launch' };
  }
  return { target: await openFullPanelAgent(page), surface: 'app-embed-full-panel' };
}

function publishPass(outPath, scenarioId) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (!fs.existsSync(outPath)) return;
  const stamp = path.join(MEDIA_DIR, `.roofing-pass-${scenarioId}.stamp`);
  fs.writeFileSync(stamp, `${new Date().toISOString()}\n${outPath}\n`);
  console.log(`[PASS] ${scenarioId} → ${outPath}`);
}

const meta = {
  tenant: TENANT,
  chatSurface: CHAT_SURFACE,
  at: null,
  scenarios: {},
  passedPaths: [],
  ok: false,
  errors: [],
};
if (SCENARIO_FILTER?.length === 1 && SCENARIO_FILTER[0] === 'S5') {
  for (const name of REQUIRED_CHAT_FILES) {
    const p = path.join(MEDIA_DIR, name);
    if (fs.existsSync(p)) meta.passedPaths.push(p);
  }
}
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-dev-shm-usage', '--no-sandbox'],
});

meta.singleSession = true;
meta.chatLane = CHAT_LANE || null;

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
let chatTarget = null;

function coordinatorPrereqMet() {
  return (
    REQUIRED_CHAT_FILES.every((f) => meta.passedPaths.includes(path.join(MEDIA_DIR, f))) ||
    REQUIRED_CHAT_FILES.every((f) => fs.existsSync(path.join(MEDIA_DIR, f)))
  );
}

try {
  await login(page);
  const opened = await openChatTarget(page);
  chatTarget = opened.target;
  meta.chatSurfaceResolved = opened.surface;

  for (const sc of buildRunList()) {
    if (sc.requiresCoordinatorReady && !coordinatorPrereqMet()) {
      meta.scenarios[sc.id] = { ok: false, skipped: true, reason: 'coordinator E1/E2 not ready' };
      continue;
    }
    await runScenarioInSession(page, chatTarget, sc, meta);
    await sleep(2000);
    meta.at = new Date().toISOString();
    fs.writeFileSync(SUMMARY, JSON.stringify(meta, null, 2));
  }

  meta.ok = meta.errors.length === 0;
  meta.coordinatorReady =
    REQUIRED_CHAT_FILES.every((f) => meta.passedPaths.includes(path.join(MEDIA_DIR, f)));
} catch (e) {
  meta.errors.push(String(e.message || e));
} finally {
  for (const name of REQUIRED_CHAT_FILES) {
    const failed = path.join(MEDIA_DIR, name.replace('.png', '-FAILED.png'));
    if (fs.existsSync(failed)) fs.unlinkSync(failed);
  }
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}

meta.at = new Date().toISOString();
if (meta.coordinatorReady === undefined) meta.coordinatorReady = false;
fs.writeFileSync(SUMMARY, JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
process.exit(meta.errors.length === 0 ? 0 : 1);
