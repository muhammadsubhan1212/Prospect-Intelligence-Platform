/**
 * PHASE 1.1 — Headless-render fallback for JS-heavy (SPA-shell) sites.
 *
 * Pure heuristic detection is dependency-free (no external calls). The actual
 * headless render is optional: it dynamically requires "puppeteer" and, if
 * that package isn't installed, degrades gracefully (returns null) instead
 * of throwing. This keeps the pipeline dependency-free by default while
 * still supporting a real headless render when the operator installs
 * puppeteer (`npm install puppeteer` in prospect-platform).
 *
 * Nothing here ever throws — every path returns a safe value.
 */

const MIN_BODY_CHARS = 200;

function textLen(html) {
    try {
        return String(html || "")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim().length;
    } catch {
        return 0;
    }
}

/**
 * Detects SPA-shell signatures: thin body text, a single root div with no
 * meaningful children, and bundler script tags with little/no rendered
 * content around them (React/Vue/Angular/Next client-side-only shells).
 */
function detectSpaShell(html) {
    try {
        if (!html || typeof html !== "string") return { isSpaShell: false, reason: "no html" };
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        const bodyHtml = bodyMatch ? bodyMatch[1] : html;
        const chars = textLen(bodyHtml);

        const rootDivOnly = /<div[^>]+id=["'](root|app|__next|___gatsby)["'][^>]*>\s*<\/div>/i.test(bodyHtml);
        const bundlerScripts = (bodyHtml.match(/<script[^>]+src=[^>]*>/gi) || []).length;
        const thin = chars < 300;

        const isSpaShell = rootDivOnly || (thin && bundlerScripts >= 2);
        const reason = rootDivOnly
            ? "Empty root div (#root/#app/#__next) — client-only render shell"
            : isSpaShell
            ? `Body text is only ${chars} chars with ${bundlerScripts} bundler script tag(s)`
            : "Static content looks sufficient";

        return { isSpaShell, reason, bodyChars: chars, bundlerScripts };
    } catch (e) {
        return { isSpaShell: false, reason: `detection failed safely: ${String((e && e.message) || e)}` };
    }
}

let puppeteerModule; // memoized require result (undefined = not yet tried, null = unavailable)

function loadPuppeteer() {
    if (puppeteerModule !== undefined) return puppeteerModule;
    try {
        // eslint-disable-next-line global-require
        puppeteerModule = require("puppeteer");
    } catch {
        puppeteerModule = null;
    }
    return puppeteerModule;
}

/**
 * Attempts a headless render of `url`. Returns { html, ok, engine } on
 * success, or { html: "", ok: false, engine: null, reason } if puppeteer is
 * unavailable or the render fails for any reason. Never throws.
 */
async function headlessRenderFetch(url, opts = {}) {
    const timeout = opts.timeout || 15000;
    const puppeteer = loadPuppeteer();
    if (!puppeteer) {
        return { html: "", ok: false, engine: null, reason: "puppeteer not installed — headless render skipped (npm install puppeteer to enable)" };
    }
    let browser;
    try {
        browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
        const page = await browser.newPage();
        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
        );
        await page.goto(url, { waitUntil: "networkidle2", timeout });
        const html = await page.content();
        return { html: html || "", ok: !!html, engine: "puppeteer", reason: "" };
    } catch (e) {
        return { html: "", ok: false, engine: "puppeteer", reason: `headless render failed: ${String((e && e.message) || e)}` };
    } finally {
        try {
            if (browser) await browser.close();
        } catch {
            /* ignore close errors */
        }
    }
}

module.exports = { detectSpaShell, headlessRenderFetch, MIN_BODY_CHARS };
