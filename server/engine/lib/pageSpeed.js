/**
 * PHASE 3.2 / 5.1 — Optional Google PageSpeed Insights integration.
 *
 * This is the one explicitly-named paid/external API the spec allows
 * (alongside headless render). It is entirely optional: without a
 * PAGESPEED_API_KEY environment variable (or with any network failure) it
 * returns { available: false } and the caller falls back to the existing
 * basic-timing heuristic in strategy.js's analyzeWebsite() — nothing here
 * ever throws or blocks the pipeline.
 */

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

async function fetchPageSpeed(url, opts = {}) {
    const apiKey = process.env.PAGESPEED_API_KEY;
    if (!apiKey || !url) {
        return { available: false, reason: !apiKey ? "PAGESPEED_API_KEY not set — skipped" : "no url" };
    }
    const timeout = opts.timeout || 10000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const qs = new URLSearchParams({ url, key: apiKey, strategy: opts.strategy || "mobile", category: "performance" });
        const res = await fetch(`${ENDPOINT}?${qs.toString()}`, { signal: controller.signal });
        if (!res.ok) return { available: false, reason: `PageSpeed API returned status ${res.status}` };
        const json = await res.json();
        const perf = json && json.lighthouseResult && json.lighthouseResult.categories && json.lighthouseResult.categories.performance;
        const score = perf && typeof perf.score === "number" ? Math.round(perf.score * 100) : null;
        const metrics = (json && json.lighthouseResult && json.lighthouseResult.audits) || {};
        const lcp = metrics["largest-contentful-paint"] && metrics["largest-contentful-paint"].displayValue;
        const fcp = metrics["first-contentful-paint"] && metrics["first-contentful-paint"].displayValue;
        return { available: score !== null, score, lcp: lcp || null, fcp: fcp || null, reason: score === null ? "No performance score in response" : "" };
    } catch (e) {
        return { available: false, reason: `PageSpeed fetch failed safely: ${String((e && e.message) || e)}` };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { fetchPageSpeed };
