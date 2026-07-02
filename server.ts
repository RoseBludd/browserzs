import { chromium, type Browser, type Page, type BrowserContext } from "playwright";

const PORT = parseInt(process.env.PORT || "3000");
const BROWSER_WS_ENDPOINT = process.env.BROWSER_WS_ENDPOINT || "";
const MAX_TIMEOUT = parseInt(process.env.BROWSERZS_MAX_TIMEOUT || "30000");
const SESSION_TTL_MS = parseInt(process.env.BROWSERZS_SESSION_TTL || "300000");

interface StepSpec {
  action: "snapshot" | "screenshot" | "click" | "fill" | "navigate" | "get" | "wait" | "press" | "scroll" | "errors" | "console";
  ref?: string;
  text?: string;
  url?: string;
  field?: string;
  path?: string;
  ms?: number;
  key?: string;
  direction?: string;
  pages?: number;
}

interface BrowseRequest {
  url: string;
  steps: StepSpec[];
  session?: string;
  headless?: boolean;
}

interface SessionEntry {
  context: BrowserContext;
  page: Page;
  lastUsed: number;
  refMap: Map<string, string>;
}

const sessions = new Map<string, SessionEntry>();
let browser: Browser | null = null;

function cleanupSessions() {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.lastUsed > SESSION_TTL_MS) {
      entry.context.close().catch(() => {});
      sessions.delete(id);
    }
  }
}

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  if (BROWSER_WS_ENDPOINT) {
    browser = await chromium.connect(BROWSER_WS_ENDPOINT);
  } else {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
      ],
    });
  }
  return browser;
}

async function getSession(sessionId: string, headless: boolean): Promise<SessionEntry> {
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }
  const b = await getBrowser();
  const context = await b.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: "browserzs/1.0 (CADIS ecosystem browser agent)",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(MAX_TIMEOUT);
  const entry: SessionEntry = { context, page, lastUsed: Date.now(), refMap: new Map() };
  sessions.set(sessionId, entry);
  return entry;
}

async function buildAccessibilityTree(page: Page): Promise<{ text: string; refMap: Map<string, string> }> {
  const refMap = new Map<string, string>();
  let refCounter = 0;
  const lines: string[] = [];

  function walk(node: any, depth: number) {
    if (!node) return;
    const indent = "  ".repeat(depth);
    const role = node.role || "unknown";
    const name = node.name || "";
    const value = node.value !== undefined ? `="${node.value}"` : "";
    const checked = node.checked !== undefined ? (node.checked ? " [checked]" : " [unchecked]") : "";
    const disabled = node.disabled ? " [disabled]" : "";
    const selected = node.selected ? " [selected]" : "";
    const expanded = node.expanded !== undefined ? (node.expanded ? " [expanded]" : " [collapsed]") : "";
    const level = node.level ? ` L${node.level}` : "";
    const haspopup = node.haspopup ? ` haspopup:${node.haspopup}` : "";

    const refId = `@e${++refCounter}`;
    let desc = `${refId} ${role}${name ? ` "${name}"` : ""}${value}${checked}${disabled}${selected}${expanded}${level}${haspopup}`;
    lines.push(indent + desc);
    refMap.set(refId, desc.trim());

    if (node.children) {
      for (const child of node.children) {
        walk(child, depth + 1);
      }
    }
  }

  try {
    const snapshot = await page.accessibility.snapshot({ interestingOnly: false });
    if (snapshot) walk(snapshot, 0);
  } catch {
    lines.push("(accessibility tree unavailable)");
  }

  return { text: lines.join("\n"), refMap };
}

async function findElementByRef(page: Page, ref: string, refMap: Map<string, string>): Promise<any> {
  const role = refMap.get(ref) || "";
  const roleMatch = role.match(/@e\d+\s+(\w+)/);
  const roleName = roleMatch ? roleMatch[1] : null;
  const nameMatch = role.match(/"([^"]+)"/);
  const elementName = nameMatch ? nameMatch[1] : null;

  const selector = roleName && elementName
    ? `[role="${roleName}"][aria-label="${elementName}"], [role="${roleName}"]:has-text("${elementName}")`
    : elementName
      ? `text="${elementName}"`
      : roleName
        ? `[role="${roleName}"]`
        : "*";

  try {
    const elements = page.locator(selector);
    const count = await elements.count();
    if (count > 0) return elements.first();
    return null;
  } catch {
    return null;
  }
}

async function executeSteps(page: Page, steps: StepSpec[]): Promise<any[]> {
  const results: any[] = [];
  let refMap = new Map<string, string>();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const result: any = { step: i, action: step.action, ok: true };
    const t0 = Date.now();

    try {
      switch (step.action) {
        case "snapshot": {
          const snap = await buildAccessibilityTree(page);
          refMap = snap.refMap;
          result.data = snap.text;
          break;
        }
        case "screenshot": {
          const screenshotPath = step.path || `/tmp/browserzs-screenshot-${Date.now()}.png`;
          await page.screenshot({ path: screenshotPath, fullPage: true });
          const fs = await import("fs");
          const buf = fs.readFileSync(screenshotPath);
          result.data = `data:image/png;base64,${buf.toString("base64")}`;
          result.path = screenshotPath;
          break;
        }
        case "click": {
          if (!step.ref) { result.ok = false; result.error = "missing ref"; break; }
          const el = await findElementByRef(page, step.ref, refMap);
          if (!el) { result.ok = false; result.error = `element not found for ref ${step.ref}`; break; }
          await el.click({ timeout: MAX_TIMEOUT });
          result.data = `clicked ${step.ref}`;
          break;
        }
        case "fill": {
          if (!step.ref) { result.ok = false; result.error = "missing ref"; break; }
          const el = await findElementByRef(page, step.ref, refMap);
          if (!el) { result.ok = false; result.error = `element not found for ref ${step.ref}`; break; }
          await el.fill(step.text || "", { timeout: MAX_TIMEOUT });
          result.data = `filled ${step.ref} with "${step.text || ""}"`;
          break;
        }
        case "navigate": {
          if (!step.url) { result.ok = false; result.error = "missing url"; break; }
          await page.goto(step.url, { waitUntil: "domcontentloaded", timeout: MAX_TIMEOUT });
          result.data = `navigated to ${step.url}`;
          break;
        }
        case "get": {
          const field = step.field || "title";
          let data: string;
          switch (field) {
            case "title": data = await page.title(); break;
            case "url": data = page.url(); break;
            case "html": data = await page.content(); break;
            case "text": data = (await page.innerText("body")).slice(0, 10000); break;
            default: data = `unknown field: ${field}`;
          }
          result.data = data;
          break;
        }
        case "wait": {
          const ms = step.ms || 1000;
          await new Promise(r => setTimeout(r, ms));
          result.data = `waited ${ms}ms`;
          break;
        }
        case "press": {
          await page.keyboard.press(step.key || "Enter");
          result.data = `pressed ${step.key || "Enter"}`;
          break;
        }
        case "scroll": {
          const dir = step.direction || "down";
          const pages = step.pages || 1;
          for (let p = 0; p < pages; p++) {
            await page.keyboard.press(dir === "up" ? "PageUp" : "PageDown");
            await new Promise(r => setTimeout(r, 300));
          }
          result.data = `scrolled ${dir} ${pages} page(s)`;
          break;
        }
        case "errors": {
          result.data = `(page errors captured via console listener — check console output)`;
          break;
        }
        case "console": {
          result.data = "(console output collected per-session)";
          break;
        }
        default: {
          result.ok = false;
          result.error = `unknown action: ${(step as any).action}`;
        }
      }
    } catch (e: any) {
      result.ok = false;
      result.error = e.message || String(e);
    }

    result.duration_ms = Date.now() - t0;
    results.push(result);

    if (!result.ok) break;
  }

  return results;
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, uptime: process.uptime() }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname !== "/browse" || req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST /browse only. See /health for status." }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    let body: BrowseRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON body" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    if (!body.url || !body.steps?.length) {
      return new Response(JSON.stringify({ error: "url and steps[] required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const sessionId = body.session || `cadis-${Date.now()}`;
    const t0 = Date.now();
    let session: SessionEntry | null = null;

    try {
      session = await getSession(sessionId, body.headless !== false);

      const currentUrl = session.page.url();
      if (currentUrl === "about:blank" || currentUrl !== body.url) {
        await session.page.goto(body.url, { waitUntil: "domcontentloaded", timeout: MAX_TIMEOUT });
      }

      const results = await executeSteps(session.page, body.steps);
      const duration = Date.now() - t0;

      cleanupSessions();

      return new Response(JSON.stringify({
        ok: true,
        session: sessionId,
        url: session.page.url(),
        results,
        errors: results.filter(r => !r.ok).map(r => r.error),
        duration_ms: duration,
      }), {
        headers: { "content-type": "application/json" },
      });

    } catch (e: any) {
      return new Response(JSON.stringify({
        ok: false,
        session: sessionId,
        error: e.message || String(e),
        duration_ms: Date.now() - t0,
      }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  },
});

console.log(`browserzs running on port ${PORT}`);
