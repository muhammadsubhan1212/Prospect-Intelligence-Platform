/**
 * Automated, DEEP web research (dependency-free, uses Node's global fetch).
 *
 * For a lead's website it:
 *   - fetches the homepage, discovers key pages AND probes common paths
 *     (about, services, solutions, products, pricing, contact, team,
 *      case-studies, industries, faq...) in parallel
 *   - parses structured data (JSON-LD / schema.org) for hard facts
 *   - extracts: company description, value proposition, services, audience,
 *     business model + monetisation, founding year, team-size hints, address,
 *     contacts, social links, ratings/social-proof
 *   - detects a broad set of technologies from HTML + response headers
 *
 * It never fabricates. Anything not observed is left empty and later rendered
 * as "Not enough public information." Social networks (LinkedIn/FB/IG) are
 * login-gated; their URLs are recorded but content is not scraped.
 */

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

const MAX_PAGES = 10;

// ---------------------------------------------------------------------------
// url helpers
// ---------------------------------------------------------------------------

function normalizeUrl(raw) {
    if (!raw) return "";
    let u = String(raw).trim();
    if (!/^https?:\/\//i.test(u)) u = "https://" + u.replace(/^\/+/, "");
    try {
        return new URL(u).toString();
    } catch {
        return "";
    }
}

function hostOf(url) {
    try {
        return new URL(url).host.replace(/^www\./, "");
    } catch {
        return "";
    }
}

function sameHost(a, b) {
    return hostOf(a) === hostOf(b);
}

async function fetchPage(url, timeout = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const start = Date.now();
    try {
        const res = await fetch(url, {
            redirect: "follow",
            signal: controller.signal,
            headers: {
                "User-Agent": UA,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        });
        const ct = res.headers.get("content-type") || "";
        let html = "";
        if (ct.includes("html") || ct === "" || ct.includes("xml")) html = await res.text();
        return {
            ok: res.ok,
            status: res.status,
            finalUrl: res.url || url,
            contentType: ct,
            headers: Object.fromEntries(res.headers.entries()),
            html,
            bytes: html.length,
            ms: Date.now() - start,
        };
    } catch (e) {
        return { ok: false, status: 0, finalUrl: url, html: "", error: String((e && e.message) || e), ms: Date.now() - start, headers: {} };
    } finally {
        clearTimeout(timer);
    }
}

async function fetchMany(urls, timeout) {
    return Promise.all(urls.map((u) => fetchPage(u, timeout)));
}

// ---------------------------------------------------------------------------
// html primitives
// ---------------------------------------------------------------------------

function findAll(re, text) {
    const out = new Set();
    let m;
    while ((m = re.exec(text)) !== null) out.add(m[1] !== undefined ? m[1] : m[0]);
    return [...out];
}

function stripTags(s) {
    return String(s || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
        .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
}

function textContent(html) {
    return stripTags(
        html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    );
}

function extractAnchors(html, baseUrl) {
    const anchors = [];
    const re = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        let abs = "";
        try {
            abs = new URL(m[2], baseUrl).toString();
        } catch {
            continue;
        }
        anchors.push({ href: abs, text: stripTags(m[3]) });
    }
    return anchors;
}

function metaContent(html, name) {
    const re = new RegExp(`<meta[^>]+(?:name|property)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']+)["']`, "i");
    const m = html.match(re);
    if (m) return stripTags(m[1]);
    const re2 = new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]*(?:name|property)\\s*=\\s*["']${name}["']`, "i");
    const m2 = html.match(re2);
    return m2 ? stripTags(m2[1]) : "";
}

function pageTitle(html) {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? stripTags(m[1]) : "";
}

function headings(html, tag) {
    return findAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"), html)
        .map((h) => stripTags(h))
        .filter(Boolean);
}

function listItems(html) {
    return headings(html, "li");
}

// ---------------------------------------------------------------------------
// JSON-LD / schema.org
// ---------------------------------------------------------------------------

function extractJsonLd(html) {
    const blocks = findAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi, html);
    const nodes = [];
    for (const raw of blocks) {
        let parsed;
        try {
            parsed = JSON.parse(raw.trim());
        } catch {
            // try to salvage by trimming trailing junk
            try {
                parsed = JSON.parse(raw.trim().replace(/,\s*}/g, "}").replace(/,\s*]/g, "]"));
            } catch {
                continue;
            }
        }
        collectNodes(parsed, nodes);
    }
    return nodes;
}

function collectNodes(node, acc) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
        node.forEach((n) => collectNodes(n, acc));
        return;
    }
    if (node["@graph"]) collectNodes(node["@graph"], acc);
    if (node["@type"]) acc.push(node);
    // Recurse into nested objects that might hold more typed entities
    for (const k of Object.keys(node)) {
        const v = node[k];
        if (v && typeof v === "object" && k !== "@graph") collectNodes(v, acc);
    }
}

function typeMatches(node, wanted) {
    const t = node["@type"];
    const arr = Array.isArray(t) ? t : [t];
    return arr.some((x) => typeof x === "string" && wanted.some((w) => x.toLowerCase().includes(w)));
}

function addressToString(a) {
    if (!a) return "";
    if (typeof a === "string") return a;
    const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry]
        .map((p) => (p && typeof p === "object" ? p.name || "" : p))
        .filter(Boolean);
    return parts.join(", ");
}

function summariseJsonLd(nodes) {
    const out = { socials: [], offers: [], services: [] };
    for (const n of nodes) {
        if (typeMatches(n, ["organization", "localbusiness", "corporation", "onlinebusiness", "professionalservice", "store"])) {
            if (!out.name && n.name) out.name = stripTags(String(n.name));
            if (!out.description && n.description) out.description = stripTags(String(n.description));
            if (!out.telephone && n.telephone) out.telephone = String(n.telephone);
            if (!out.email && n.email) out.email = String(n.email).replace(/^mailto:/i, "");
            if (!out.address && n.address) out.address = addressToString(n.address);
            if (!out.foundingDate && n.foundingDate) out.foundingDate = String(n.foundingDate);
            if (!out.numberOfEmployees && n.numberOfEmployees) {
                const ne = n.numberOfEmployees;
                out.numberOfEmployees = typeof ne === "object" ? ne.value || ne.name || "" : String(ne);
            }
            if (n.founder) {
                const f = Array.isArray(n.founder) ? n.founder : [n.founder];
                out.founders = f.map((x) => (typeof x === "object" ? x.name : x)).filter(Boolean);
            }
            if (n.sameAs) {
                const sa = Array.isArray(n.sameAs) ? n.sameAs : [n.sameAs];
                out.socials.push(...sa.filter(Boolean));
            }
            if (n.areaServed) {
                const as = Array.isArray(n.areaServed) ? n.areaServed : [n.areaServed];
                out.areaServed = as.map((x) => (typeof x === "object" ? x.name : x)).filter(Boolean);
            }
            if (n.knowsAbout) {
                const ka = Array.isArray(n.knowsAbout) ? n.knowsAbout : [n.knowsAbout];
                out.knowsAbout = ka.map((x) => (typeof x === "object" ? x.name : x)).filter(Boolean);
            }
            if (n.priceRange) out.priceRange = String(n.priceRange);
        }
        if (typeMatches(n, ["aggregaterating"]) || (n.aggregateRating && typeof n.aggregateRating === "object")) {
            const ar = n.aggregateRating && typeof n.aggregateRating === "object" ? n.aggregateRating : n;
            if (ar.ratingValue) out.rating = { value: String(ar.ratingValue), count: String(ar.reviewCount || ar.ratingCount || "") };
        }
        if (typeMatches(n, ["product"])) {
            if (n.name) out.offers.push(stripTags(String(n.name)));
        }
        if (typeMatches(n, ["service"])) {
            if (n.name) out.services.push(stripTags(String(n.name)));
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// contacts / socials
// ---------------------------------------------------------------------------

function extractContacts(html) {
    const emails = new Set();
    const phones = new Set();
    findAll(/mailto:([^"'?\s>]+)/gi, html).forEach((e) => emails.add(e.replace(/^mailto:/i, "")));
    findAll(/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi, html).forEach((e) => {
        if (!/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(e)) emails.add(e);
    });
    findAll(/tel:([+0-9().\-\s]{6,})/gi, html).forEach((p) => phones.add(p.replace(/^tel:/i, "").trim()));
    findAll(/(\+?\d[\d().\-\s]{7,}\d)/g, html).forEach((p) => {
        const digits = p.replace(/\D/g, "");
        if (digits.length >= 8 && digits.length <= 15) phones.add(p.trim());
    });
    // Prefer role-based emails first
    const emailArr = [...emails].filter((e) => e.length < 60);
    emailArr.sort((a, b) => rolePriority(a) - rolePriority(b));
    return { emails: emailArr.slice(0, 6), phones: [...phones].slice(0, 6) };
}

function rolePriority(email) {
    const l = email.toLowerCase();
    if (/^(sales|hello|contact|info|enquir|inquir)/.test(l)) return 0;
    if (/^(support|admin|office)/.test(l)) return 1;
    if (/(noreply|no-reply|donotreply)/.test(l)) return 9;
    return 3;
}

function extractSocials(html, jsonLdSocials = []) {
    const socials = {};
    const patterns = {
        linkedin: /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s"'<>]+/i,
        facebook: /https?:\/\/(?:www\.)?facebook\.com\/[^\s"'<>]+/i,
        instagram: /https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>]+/i,
        twitter: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s"'<>]+/i,
        youtube: /https?:\/\/(?:www\.)?youtube\.com\/[^\s"'<>]+/i,
        tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/[^\s"'<>]+/i,
    };
    const hay = html + " " + jsonLdSocials.join(" ");
    for (const [k, re] of Object.entries(patterns)) {
        const m = hay.match(re);
        if (m) socials[k] = m[0].replace(/["'<>\\].*$/, "");
    }
    return socials;
}

// ---------------------------------------------------------------------------
// services / audience / model / description / etc.
// ---------------------------------------------------------------------------

const NAV_STOP = /(home|about|contact|blog|news|login|log in|sign|privacy|terms|careers?|faq|cookie|search|menu|team|pricing|cart|account|checkout)/i;
const SLOGAN = /\b(we|our|your|the|is|are|will|transform\w*|welcome|discover|introducing|why|how|get|let)\b/i;

// Generic navigation / footer labels that are not real offerings.
const GENERIC_NAV = new Set([
    "proof", "help", "affiliates", "features", "all features", "company", "product",
    "products", "automation", "billing", "integrations", "integration", "resources",
    "support", "docs", "documentation", "api", "careers", "career", "partners", "partner",
    "community", "marketplace", "page", "pages", "overview", "platform", "solutions",
    "services", "home", "contact", "about", "about us", "blog", "news", "pricing", "plans",
    "login", "log in", "sign up", "sign in", "get started", "demo", "book a demo", "faq",
    "faqs", "testimonials", "reviews", "gallery", "shop", "store", "cart", "account",
    "download", "terms", "privacy", "security", "status", "changelog", "roadmap", "more",
    "learn more", "read more", "menu", "search", "team", "our team", "portfolio", "work",
    "case studies", "customers", "clients", "press", "media", "events", "webinars", "guides",
    "help center", "knowledge base", "contact us", "get in touch", "our story", "mission",
]);

function isGeneric(text) {
    const t = String(text).toLowerCase().replace(/\s+/g, " ").trim().replace(/\s+pages?$/, "");
    return GENERIC_NAV.has(t);
}

function extractServices(anchors, servicesHtml, jsonLdServices = [], jsonLdOffers = []) {
    const seen = new Set();
    const services = [];
    const add = (t) => {
        const clean = stripTags(t).replace(/\s+Pages?$/i, "").trim();
        if (!clean || clean.length < 3 || clean.length > 45) return;
        if (clean.split(/\s+/).length > 6) return;
        if (isGeneric(clean)) return;
        const key = clean.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        services.push(clean);
    };
    // Structured data first (most reliable)
    jsonLdServices.forEach(add);
    jsonLdOffers.forEach(add);
    // Then the dedicated services/solutions page content
    if (servicesHtml) {
        headings(servicesHtml, "h2").concat(headings(servicesHtml, "h3")).forEach((h) => {
            if (h.split(/\s+/).length <= 5 && !NAV_STOP.test(h) && !SLOGAN.test(h)) add(h);
        });
        if (services.length < 4) {
            listItems(servicesHtml).forEach((li) => {
                if (li.split(/\s+/).length <= 4 && !NAV_STOP.test(li) && !SLOGAN.test(li) && !/@|©|\d{4}/.test(li)) add(li);
            });
        }
    }
    // Nav anchors only as a last resort, and only genuinely descriptive labels
    if (services.length < 3) {
        for (const a of anchors) {
            if (/\/(services|solutions|what-we-do|offerings|capabilit)/i.test(a.href) && !NAV_STOP.test(a.text) && !isGeneric(a.text)) add(a.text);
        }
    }
    return services.slice(0, 8);
}

function extractDescription(html, aboutHtml) {
    const meta = metaContent(html, "description") || metaContent(html, "og:description");
    if (meta && meta.length > 30) return meta;
    // First substantial paragraph on the About page
    const src = aboutHtml || html;
    const paras = findAll(/<p[^>]*>([\s\S]*?)<\/p>/gi, src)
        .map((p) => stripTags(p))
        .filter((p) => p.length >= 60 && p.length <= 400);
    return paras[0] || meta || "";
}

function extractValueProp(html) {
    const h1s = headings(html, "h1").filter((h) => h.length >= 8 && h.length <= 120);
    return h1s[0] || metaContent(html, "og:title") || "";
}

function extractFoundedYear(text) {
    const m =
        text.match(/\b(?:founded|established|est\.?|since|serving [^.]*since)\D{0,12}(\d{4})\b/i) ||
        text.match(/\bin\s+(\d{4})\b(?=[^.]{0,40}(founded|began|started|launched))/i);
    if (m) {
        const y = parseInt(m[1], 10);
        if (y >= 1900 && y <= new Date().getFullYear()) return String(y);
    }
    return "";
}

function extractTeamHints(text, jsonLdEmployees) {
    if (jsonLdEmployees) return String(jsonLdEmployees);
    const m =
        text.match(/\bteam of\s+(\d{1,4})\b/i) ||
        text.match(/\b(\d{1,4})\+?\s+(?:employees|team members|professionals|experts|specialists|staff)\b/i);
    return m ? m[1] : "";
}

function detectBusinessModel(text, tech, signals) {
    const t = text.toLowerCase();
    const scores = { ecommerce: 0, saas: 0, services: 0, local: 0, content: 0 };

    if (/add to (cart|bag|basket)|shopping cart|\/cart|\/checkout|proceed to checkout|buy now|shop now/.test(t)) scores.ecommerce += 3;
    if (tech.stack.some((x) => /Shopify|WooCommerce|BigCommerce|Magento|Wix Stores/i.test(x))) scores.ecommerce += 3;
    if (/free shipping|in stock|out of stock|sku\b/.test(t)) scores.ecommerce += 1;

    if (/free trial|start (for )?free|sign up free|per (month|user)|\/mo\b|\/month|monthly plan|subscription|book a demo|request a demo|log ?in|dashboard|\bapi\b|integrations?/.test(t)) scores.saas += 2;
    if (signals.pricing) scores.saas += 1;
    if (/pricing (plans?|tiers?)|most popular plan|billed (annually|monthly)/.test(t)) scores.saas += 2;

    if (/our services|get a (free )?quote|request a quote|book (a )?(free )?(consultation|call)|case studies|our work|portfolio|clients we|we help|we work with/.test(t)) scores.services += 2;
    if (signals.caseStudies) scores.services += 1;

    if (/opening hours|business hours|visit us|get directions|our (location|address|store)|book an appointment|walk-ins/.test(t)) scores.local += 2;
    if (signals.address) scores.local += 1;

    if (/read more articles|latest posts|subscribe to our newsletter|advertise with us/.test(t) && signals.blog) scores.content += 1;

    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const type = best[1] > 0 ? best[0] : "business";

    const MONETISATION = {
        ecommerce: "Online product sales (e-commerce checkout detected).",
        saas: "Software subscriptions / recurring plans (pricing & sign-up flow detected).",
        services: "Selling services / projects (quote & consultation flow detected).",
        local: "Local service or storefront revenue (location & booking signals detected).",
        content: "Content/advertising or lead generation model (inferred).",
        business: "Not clearly determinable from the website (likely direct sales or services).",
    };
    return { type, monetisation: MONETISATION[type], scores };
}

function extractAudience(text) {
    const patterns = [
        /industries we serve[:\s]+([^.<]{5,120})/i,
        /who we (?:serve|help)[:\s]+([^.<]{5,120})/i,
        /(?:built|designed|made) for\s+([^.<]{5,80})/i,
        /we (?:help|work with|partner with)\s+([^.<]{5,100})/i,
        /trusted by\s+([^.<]{5,100})/i,
        /our clients (?:include|are)\s+([^.<]{5,120})/i,
    ];
    for (const re of patterns) {
        const m = text.match(re);
        if (m && m[1]) return stripTags(m[1]).replace(/\s+/g, " ").trim();
    }
    // B2B/B2C hint
    if (/\bb2b\b|enterprise|businesses|companies|teams|agencies/i.test(text)) return "";
    return "";
}

// ---------------------------------------------------------------------------
// technology detection (broad)
// ---------------------------------------------------------------------------

const TECH_SIGNATURES = [
    // CMS / builders
    ["WordPress", /wp-content|wp-json|wp-includes/i],
    ["Wix", /wix\.com|wixstatic\.com|_wixCssStates/i],
    ["Squarespace", /squarespace\.com|static1\.squarespace/i],
    ["Webflow", /webflow\.com|wf-page|data-wf-(page|site)/i],
    ["Shopify", /cdn\.shopify\.com|shopify\.theme|myshopify|x-shopify/i],
    ["WooCommerce", /woocommerce|wc-ajax/i],
    ["BigCommerce", /bigcommerce\.com/i],
    ["Magento", /\bmagento\b|Mage\.Cookies|\/skin\/frontend\/|static\/version\d+\/frontend/i],
    ["HubSpot CMS", /hs-scripts\.com|hubspotusercontent|hs-sites/i],
    ["Drupal", /sites\/default\/files|drupal\.js|drupal-settings/i],
    ["Joomla", /\/media\/jui\/|joomla/i],
    ["Ghost", /ghost\.io|content\/images\/\d{4}\//i],
    ["Framer", /framerusercontent|framer\.com/i],
    ["Carrd", /carrd\.co/i],
    ["Duda", /dudamobile|d\.dudastatic\.com/i],
    ["GoDaddy Website Builder", /websites\.godaddy|dpwsstage/i],
    ["Elementor", /elementor/i],
    ["Divi", /et_pb_|divi/i],
    // JS frameworks
    ["Next.js", /__NEXT_DATA__|\/_next\//i],
    ["Nuxt", /__NUXT__|\/_nuxt\//i],
    ["React", /data-reactroot|react-dom|_reactListening/i],
    ["Vue.js", /vue(?:\.min)?\.js|data-v-[0-9a-f]{8}/i],
    ["Angular", /ng-version|angular\.js/i],
    ["Gatsby", /___gatsby|gatsby-/i],
    ["jQuery", /jquery(?:[-.]\d|(?:\.min)?\.js)/i],
    // analytics / tag / ads
    ["Google Analytics", /gtag\(|google-analytics\.com|googletagmanager\.com\/gtag|ga\('create'/i],
    ["Google Tag Manager", /googletagmanager\.com\/gtm/i],
    ["Meta Pixel", /connect\.facebook\.net|fbq\(/i],
    ["Hotjar", /static\.hotjar\.com|hjSetting/i],
    ["Microsoft Clarity", /clarity\.ms/i],
    ["LinkedIn Insight", /snap\.licdn\.com|_linkedin_partner_id/i],
    ["Google Ads", /googleadservices|gtag\/js\?id=aw-/i],
    ["Segment", /cdn\.segment\.com|analytics\.js/i],
    ["Plausible", /plausible\.io/i],
    // marketing / email / forms
    ["Mailchimp", /list-manage\.com|mailchimp|mc\.js/i],
    ["Klaviyo", /klaviyo\.com|_klOnsite/i],
    ["ActiveCampaign", /activehosted\.com|active_?campaign/i],
    ["ConvertKit", /convertkit\.com|ck\.js/i],
    ["Typeform", /typeform\.com/i],
    ["Jotform", /jotform/i],
    ["HubSpot Forms", /forms\.hsforms|js\.hsforms/i],
    ["Marketo", /marketo\.com|munchkin\.js/i],
    ["Pardot", /pardot\.com|pi\.pardot/i],
    ["Google reCAPTCHA", /recaptcha/i],
    // payment / ecommerce infra
    ["Stripe", /js\.stripe\.com|stripe\.com\/v3/i],
    ["PayPal", /paypal\.com\/sdk|paypalobjects/i],
    ["Square", /squareup\.com|square\.js/i],
    // video / media
    ["YouTube Embed", /youtube\.com\/embed|youtu\.be/i],
    ["Vimeo", /player\.vimeo\.com/i],
    ["Wistia", /wistia\.(com|net)/i],
    // fonts / cdn / security
    ["Google Fonts", /fonts\.googleapis\.com|fonts\.gstatic/i],
    ["Font Awesome", /fontawesome|font-awesome/i],
    ["Cloudflare", /cloudflare|cf-ray|__cf_bm/i],
    ["Amazon AWS", /amazonaws\.com|x-amz-/i],
    ["Google Cloud", /googleusercontent\.com|x-goog-/i],
    ["Fastly", /fastly|x-served-by/i],
    ["Bootstrap", /bootstrap(?:\.min)?\.(css|js)/i],
    ["Tailwind CSS", /tailwind|--tw-/i],
];

const CHAT_SIGNATURES = [
    ["Intercom", /widget\.intercom\.io|intercomcdn/i],
    ["Drift", /js\.driftt\.com|drift\.com/i],
    ["Tawk.to", /embed\.tawk\.to/i],
    ["Crisp", /client\.crisp\.chat/i],
    ["LiveChat", /cdn\.livechatinc\.com/i],
    ["Zendesk Chat", /static\.zdassets\.com|zopim/i],
    ["Tidio", /tidio\.co/i],
    ["HubSpot Chat", /js-na\d?\.hs-scripts\.com|js\.hs-scripts\.com/i],
    ["Facebook Messenger", /fb-customerchat|facebook\.com\/plugins\/customer/i],
    ["Freshchat", /wchat\.freshchat/i],
    ["Gorgias", /gorgias\.chat/i],
    ["ManyChat", /manychat/i],
    ["WhatsApp Chat", /wa\.me\/|api\.whatsapp\.com\/send/i],
];

const BOOKING_SIGNATURES = [
    ["Calendly", /calendly\.com/i],
    ["Acuity Scheduling", /acuityscheduling\.com|squarespace-scheduling/i],
    ["Cal.com", /\bcal\.com/i],
    ["SavvyCal", /savvycal\.com/i],
    ["YouCanBookMe", /youcanbook\.me/i],
    ["HubSpot Meetings", /meetings\.hubspot/i],
    ["Setmore", /setmore\.com/i],
    ["Booksy", /booksy\.com/i],
    ["Square Appointments", /squareup\.com\/appointments/i],
    ["OpenTable", /opentable\.com/i],
];

function detectFrom(signatures, hay) {
    const found = [];
    for (const [name, re] of signatures) if (re.test(hay)) found.push(name);
    return found;
}

function detectFromHeaders(headers) {
    const out = [];
    const server = (headers.server || "").toLowerCase();
    const powered = (headers["x-powered-by"] || "").toLowerCase();
    if (server.includes("nginx")) out.push("Nginx");
    if (server.includes("apache")) out.push("Apache");
    if (server.includes("cloudflare")) out.push("Cloudflare");
    if (server.includes("litespeed")) out.push("LiteSpeed");
    if (powered.includes("php")) out.push("PHP");
    if (powered.includes("asp.net")) out.push("ASP.NET");
    if (powered.includes("express")) out.push("Express.js");
    if (powered.includes("next")) out.push("Next.js");
    if ((headers["x-shopify-stage"] || headers["x-sorting-hat-shopid"])) out.push("Shopify");
    return out;
}

function generatorTag(html) {
    const g = metaContent(html, "generator");
    return g ? [g.split(",")[0].trim()] : [];
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function researchWebsite(lead, opts = {}) {
    const timeout = opts.timeout || 12000;
    const result = {
        website: "",
        reachable: false,
        pages: {},
        facts: {
            emails: [], phones: [], socials: {}, services: [], title: "", description: "",
            valueProp: "", address: "", audience: "", foundedYear: "", teamHint: "",
            founders: [], rating: null, areaServed: [], businessModel: null, sources: {},
        },
        tech: { stack: [], chat: [], booking: [] },
        signals: {},
        homepage: null,
        notes: [],
    };

    const website = normalizeUrl(lead.website);
    result.website = website;
    if (!website) {
        result.notes.push("No website supplied in the lead record; analysis limited to provided data.");
        return result;
    }

    const home = await fetchPage(website, timeout);
    result.homepage = { url: home.finalUrl, status: home.status, ms: home.ms, bytes: home.bytes };
    if (!home.ok || !home.html) {
        result.notes.push(`Website could not be fetched (status ${home.status}${home.error ? ", " + home.error : ""}).`);
        return result;
    }
    result.reachable = true;
    const baseUrl = home.finalUrl;

    // Discover from nav + probe common paths
    const anchors = extractAnchors(home.html, baseUrl);
    const discovered = discoverPages(anchors, baseUrl);
    const guesses = [
        "about", "about-us", "company", "our-story",
        "services", "our-services", "solutions", "what-we-do", "products", "product",
        "pricing", "plans", "contact", "contact-us",
        "team", "our-team", "case-studies", "portfolio", "work", "clients",
        "industries", "who-we-serve", "faq", "testimonials", "reviews",
    ];
    const candidateMap = {};
    Object.entries(discovered).forEach(([k, v]) => (candidateMap[v.split("#")[0]] = k));
    for (const g of guesses) {
        try {
            const u = new URL("/" + g, baseUrl).toString();
            if (!candidateMap[u]) candidateMap[u] = g;
        } catch {}
    }
    const candidates = Object.keys(candidateMap).filter((u) => sameHost(u, baseUrl)).slice(0, MAX_PAGES);

    const fetchedPages = await fetchMany(candidates, timeout);
    const pageByRole = { home: home.html };
    const okPages = [{ role: "home", url: baseUrl, html: home.html, headers: home.headers }];
    // Fingerprints let us drop SPA/soft-404 catch-alls that echo the homepage
    // for every guessed path (so we don't get "about, about, about...").
    const fingerprint = (html) => {
        const txt = textContent(html);
        return `${pageTitle(html)}|${txt.length}`;
    };
    const seenFingerprints = new Set([fingerprint(home.html)]);
    fetchedPages.forEach((p, i) => {
        if (!(p.ok && p.html && p.bytes > 200)) return;
        const fp = fingerprint(p.html);
        if (seenFingerprints.has(fp)) return; // duplicate of homepage or another page
        seenFingerprints.add(fp);
        const role = candidateMap[candidates[i]];
        const key = /about|company|story/i.test(role) ? "about"
            : /service|solution|product|what-we-do/i.test(role) ? "services"
            : /contact/i.test(role) ? "contact"
            : /pricing|plans/i.test(role) ? "pricing"
            : /team/i.test(role) ? "team"
            : /case|portfolio|work|client/i.test(role) ? "caseStudies"
            : /industr|who-we-serve/i.test(role) ? "industries"
            : role;
        if (pageByRole[key]) return; // already have a page for this role
        pageByRole[key] = p.html;
        result.pages[key] = p.finalUrl;
        okPages.push({ role: key, url: p.finalUrl, html: p.html, headers: p.headers });
    });
    result.pages.home = baseUrl;

    const combinedHtml = okPages.map((p) => p.html).join("\n");
    const combinedText = textContent(combinedHtml);

    // JSON-LD across all pages
    const ldNodes = [];
    okPages.forEach((p) => ldNodes.push(...extractJsonLd(p.html)));
    const ld = summariseJsonLd(ldNodes);

    // Source/provenance for every extracted fact so a human can verify it.
    const sources = {};
    const src = (where, url) => ({ where, url: url || baseUrl });

    // Contacts + socials (JSON-LD wins where present)
    const contacts = extractContacts(combinedHtml);
    result.facts.emails = [...new Set([ld.email, ...contacts.emails].filter(Boolean))].slice(0, 6);
    result.facts.phones = [...new Set([ld.telephone, ...contacts.phones].filter(Boolean))].slice(0, 6);
    result.facts.socials = extractSocials(combinedHtml, ld.socials);
    if (result.facts.emails.length) sources.emails = ld.email ? src("Structured data (schema.org email)", baseUrl) : src("Contact page / page footer", result.pages.contact || baseUrl);
    if (result.facts.phones.length) sources.phones = ld.telephone ? src("Structured data (schema.org telephone)", baseUrl) : src("Contact page / page footer", result.pages.contact || baseUrl);
    if (Object.keys(result.facts.socials).length) sources.socials = src("Page footer links / structured data (sameAs)", baseUrl);

    // Services / description / value prop
    result.facts.services = extractServices(anchors, pageByRole.services, ld.services, ld.offers);
    if (result.facts.services.length) {
        sources.services = (ld.services.length || ld.offers.length)
            ? src("Structured data (schema.org Service/Product)", baseUrl)
            : pageByRole.services
            ? src("Services / solutions page", result.pages.services)
            : src("Homepage navigation & section headings", baseUrl);
    }

    result.facts.title = pageTitle(home.html);

    const metaDesc = metaContent(home.html, "description") || metaContent(home.html, "og:description");
    result.facts.description = ld.description || extractDescription(home.html, pageByRole.about);
    if (result.facts.description) {
        sources.description = ld.description
            ? src("Structured data (schema.org description)", baseUrl)
            : metaDesc && metaDesc.length > 30
            ? src("Homepage meta description (<head>)", baseUrl)
            : src("About page, opening paragraph", result.pages.about || baseUrl);
    }

    result.facts.valueProp = extractValueProp(home.html);
    if (result.facts.valueProp) sources.valueProp = src("Homepage headline (main H1)", baseUrl);

    result.facts.address = ld.address || extractAddressText(combinedHtml);
    if (result.facts.address) {
        sources.address = ld.address
            ? src("Structured data (schema.org PostalAddress)", baseUrl)
            : src("Contact page / page footer", result.pages.contact || baseUrl);
    }

    result.facts.foundedYear = ld.foundingDate ? String(ld.foundingDate).slice(0, 4) : extractFoundedYear(combinedText);
    if (result.facts.foundedYear) {
        sources.foundedYear = ld.foundingDate
            ? src("Structured data (schema.org foundingDate)", baseUrl)
            : src('Site copy ("founded / since / established")', baseUrl);
    }

    result.facts.audience = extractAudience(combinedText) || (ld.areaServed ? ld.areaServed.join(", ") : "");
    if (result.facts.audience) {
        sources.audience = ld.areaServed && !extractAudience(combinedText)
            ? src("Structured data (schema.org areaServed)", baseUrl)
            : src('Site copy ("who we serve" / "we help" / "trusted by")', baseUrl);
    }

    result.facts.founders = ld.founders || [];
    result.facts.rating = ld.rating || null;
    if (result.facts.rating) sources.rating = src("Structured data (schema.org aggregateRating)", baseUrl);
    result.facts.areaServed = ld.areaServed || [];

    // Technologies (html + headers + generator)
    const hay = combinedHtml + " " + JSON.stringify(home.headers || {});
    result.tech.stack = [...new Set([...detectFrom(TECH_SIGNATURES, hay), ...detectFromHeaders(home.headers), ...generatorTag(home.html)])];
    result.tech.chat = detectFrom(CHAT_SIGNATURES, hay);
    result.tech.booking = detectFrom(BOOKING_SIGNATURES, hay);
    if (result.tech.stack.length || result.tech.chat.length || result.tech.booking.length)
        sources.technologies = src("Detected in page source code & HTTP response headers", baseUrl);

    // Signals for the analyzer + model
    const s = {
        https: /^https:/i.test(baseUrl),
        viewportMeta: /<meta[^>]+name\s*=\s*["']viewport["']/i.test(home.html),
        hasForm: /<form\b/i.test(combinedHtml),
        hasContactPage: !!result.pages.contact,
        navLinkCount: anchors.filter((a) => sameHost(a.href, baseUrl)).length,
        ctaMatches: (combinedHtml.match(/\b(get started|book (a )?(demo|call|appointment)|request (a )?(quote|demo|consultation)|contact us|sign up|schedule|free (trial|quote|consultation)|call now|get (a )?quote|add to (cart|bag))\b/gi) || []).length,
        testimonials: /\btestimonial|what our clients say|client stories|success stories|kind words\b/i.test(combinedHtml),
        reviews: /trustpilot|g\.page|google review|yelp\.com|\breviews?\b/i.test(combinedHtml) || !!ld.rating,
        clientLogos: /\b(our clients|trusted by|as seen (in|on)|partners|brands we)\b/i.test(combinedHtml),
        newsletter: /\b(subscribe|newsletter|join our (mailing )?list|sign up for updates)\b/i.test(combinedHtml),
        popup: /(exit-intent|popup|modal-subscribe)/i.test(combinedHtml),
        homepageMs: home.ms,
        homepageBytes: home.bytes,
        pagesFetched: okPages.map((p) => p.role),
        blog: !!result.pages.blog,
        pricing: !!result.pages.pricing,
        caseStudies: !!result.pages.caseStudies,
        address: !!(ld.address || result.facts.address),
        wordCount: textContent(home.html).split(/\s+/).length,
        blogPostCount: countBlogPosts(pageByRole.blog),
        teamMemberCount: countTeamMembers(pageByRole.team),
    };
    result.facts.teamHint = extractTeamHints(combinedText, ld.numberOfEmployees) || (s.teamMemberCount ? String(s.teamMemberCount) : "");
    result.facts.businessModel = detectBusinessModel(combinedText, result.tech, s);
    if (result.facts.businessModel && result.facts.businessModel.type !== "business")
        sources.businessModel = src("Inferred from on-site signals (cart / pricing / booking / quote flows)", baseUrl);
    result.facts.sources = sources;
    result.signals = s;
    // Flat list of the pages actually reviewed, with their URLs, for verification.
    result.crawledPages = okPages.map((p) => [p.role, p.url]);

    if ([lead.linkedin, lead.companyLinkedin, lead.facebook, lead.instagram].some(Boolean)) {
        result.notes.push("Social profiles (LinkedIn/Facebook/Instagram) are login-gated; URLs are recorded from the lead data but content is not scraped.");
    }

    return result;
}

function discoverPages(anchors, baseUrl) {
    const found = {};
    const wants = {
        about: /\b(about|who-we-are|our-story|company)\b/i,
        services: /\b(services|solutions|products|what-we-do|offerings|capabilities)\b/i,
        contact: /\b(contact|get-in-touch|reach-us)\b/i,
        blog: /\b(blog|news|insights|articles|resources)\b/i,
        pricing: /\b(pricing|plans|packages)\b/i,
        booking: /\b(book|appointment|schedule|demo|consultation)\b/i,
        caseStudies: /\b(case-stud|portfolio|our-work|case_stud)\b/i,
        team: /\b(team|our-team|leadership|people)\b/i,
        industries: /\b(industries|who-we-serve|sectors)\b/i,
    };
    for (const a of anchors) {
        if (!sameHost(a.href, baseUrl)) continue;
        const probe = (a.href + " " + a.text).toLowerCase();
        for (const [key, re] of Object.entries(wants)) {
            if (found[key]) continue;
            if (re.test(probe)) found[key] = a.href.split("#")[0];
        }
    }
    return found;
}

function extractAddressText(html) {
    const m = html.match(/\b\d{1,5}\s+[A-Za-z0-9.\-'\s]{3,40}\b(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Suite|Ste|Highway|Hwy|Parkway|Pkwy)\b[A-Za-z0-9.,\-'\s]{0,40}/i);
    return m ? stripTags(m[0]).replace(/\s+/g, " ").trim() : "";
}

function countBlogPosts(blogHtml) {
    if (!blogHtml) return 0;
    const articles = (blogHtml.match(/<article\b/gi) || []).length;
    if (articles) return articles;
    const posts = (blogHtml.match(/\b(read more|continue reading|posted on|by\s+\w+\s+on)\b/gi) || []).length;
    return posts;
}

function countTeamMembers(teamHtml) {
    if (!teamHtml) return 0;
    // crude: count occurrences of role words near names
    const roles = (teamHtml.match(/\b(CEO|CTO|COO|CFO|Founder|Co-Founder|Director|Manager|Head of|Lead|Engineer|Designer|Developer|Consultant|Partner)\b/gi) || []).length;
    return Math.min(roles, 200);
}

module.exports = {
    researchWebsite,
    normalizeUrl,
    hostOf,
    fetchPage,
    extractContacts,
    extractSocials,
    extractJsonLd,
    summariseJsonLd,
    discoverPages,
    extractAnchors,
    detectBusinessModel,
    detectFrom,
    TECH_SIGNATURES,
    CHAT_SIGNATURES,
    BOOKING_SIGNATURES,
};
