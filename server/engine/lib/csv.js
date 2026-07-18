/**
 * Minimal, dependency-free CSV reader + flexible lead-field mapper.
 * Handles RFC-4180 quoting (quoted fields, escaped quotes, embedded commas
 * and newlines) which the Apollo-style export files require.
 */

const fs = require("fs");

function parseCSV(text) {
    // Strip UTF-8 BOM if present
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = [];
    let field = "";
    let row = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
        } else {
            if (c === '"') {
                inQuotes = true;
            } else if (c === ",") {
                row.push(field);
                field = "";
            } else if (c === "\r") {
                // ignore; handled by \n
            } else if (c === "\n") {
                row.push(field);
                rows.push(row);
                row = [];
                field = "";
            } else {
                field += c;
            }
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

function readCSVObjects(filePath) {
    const text = fs.readFileSync(filePath, "utf8");
    const rows = parseCSV(text).filter((r) => r.length && !(r.length === 1 && r[0].trim() === ""));
    if (!rows.length) return { headers: [], records: [] };
    const headers = rows[0].map((h) => h.trim());
    const records = rows.slice(1).map((r) => {
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = (r[i] !== undefined ? r[i] : "").trim();
        });
        return obj;
    });
    return { headers, records };
}

// --- Flexible header aliasing ------------------------------------------------

function norm(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Detect row-index / test-label values so they are never treated as real data.
 * Matches things like: Test-R34, Test-R100, R21, Row-5, Sample_12, Lead 8,
 * #34, id-123, or a bare number. Requires the WHOLE value to be an
 * (optional known prefix)(optional R)(digits) shape, so real names/companies
 * such as "Studio 54" or "Web3 Labs" are left untouched.
 */
function isIndexLike(v) {
    const s = String(v || "").trim();
    if (!s) return true;
    return /^(test|row|sample|lead|record|index|idx|id|no|num|item|entry|ref)?[\s_\-#:.]*r?\d+$/i.test(s);
}

/** Header names that are pure export artefacts and should be ignored outright. */
function isIgnoredHeader(h) {
    const n = norm(h);
    // e.g. "Unnamed: 46", empty columns, Apollo internal ids
    return !n || /^unnamed\d*$/.test(n);
}

// Canonical field -> list of accepted header aliases (normalised)
const ALIASES = {
    firstName: ["firstname", "first"],
    lastName: ["lastname", "last"],
    fullName: ["fullname", "name", "contactname"],
    title: ["title", "jobtitle", "position", "role"],
    seniority: ["seniority"],
    department: ["departments", "department", "subdepartments"],
    company: ["companyname", "company", "organization", "organisation", "account", "companynameforemails"],
    email: ["email", "emailaddress", "workemail"],
    emailStatus: ["emailstatus"],
    phone: ["cleanphone", "mobilephone", "workdirectphone", "phone", "directphone", "corporatephone", "companyphone", "otherphone", "homephone"],
    website: ["website", "companywebsite", "url", "domain", "websiteurl"],
    linkedin: ["personlinkedinurl", "linkedinprofile", "linkedin", "linkedinurl", "personallinkedin"],
    companyLinkedin: ["companylinkedinurl", "companylinkedin"],
    facebook: ["facebookurl", "facebook"],
    instagram: ["instagramurl", "instagram"],
    twitter: ["twitterurl", "twitter", "x"],
    industry: ["industry"],
    keywords: ["keywords"],
    technologies: ["technologies", "technologiesused", "techstack"],
    address: ["companyaddress", "address"],
    city: ["city", "companycity"],
    state: ["state", "companystate"],
    country: ["country", "companycountry"],
    employees: ["employees", "numberofemployees", "#employees", "companysize", "estimatedemployees"],
    annualRevenue: ["annualrevenue", "estimatedrevenue", "revenue"],
    totalFunding: ["totalfunding", "funding"],
    latestFunding: ["latestfunding"],
    latestFundingAmount: ["latestfundingamount"],
    lastRaisedAt: ["lastraisedat"],
    notes: ["notes"],
};

function buildHeaderIndex(headers) {
    const map = {};
    headers.forEach((h) => {
        map[norm(h)] = h;
    });
    return map;
}

function cleanPhone(v) {
    if (!v) return "";
    // Apollo exports often prefix phones with a stray apostrophe: '+1 843...
    return String(v).replace(/^'+/, "").trim();
}

/**
 * Map one raw CSV record (object keyed by original headers) into the canonical
 * lead shape used by the research engine. Picks the first non-empty alias.
 */
function mapRecordToLead(record, headers) {
    const idx = buildHeaderIndex(headers);
    const get = (canonical) => {
        const aliases = ALIASES[canonical] || [];
        for (const a of aliases) {
            const original = idx[a];
            if (original && isIgnoredHeader(original)) continue;
            const raw = original ? String(record[original] || "").trim() : "";
            if (!raw) continue;
            // Ignore row-index / test labels (e.g. the "Name" column full of
            // "Test-R34"). This lets fullName fall back to First + Last name.
            if (isIndexLike(raw)) continue;
            return raw;
        }
        return "";
    };

    const firstName = get("firstName");
    const lastName = get("lastName");
    let fullName = get("fullName");
    if (!fullName) fullName = [firstName, lastName].filter(Boolean).join(" ");

    // Gather all phone-like columns, prefer mobile/direct
    const phone = cleanPhone(get("phone"));

    const splitList = (v) =>
        v
            ? v.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
            : [];

    return {
        fullName: fullName || "",
        firstName,
        lastName,
        title: get("title"),
        seniority: get("seniority"),
        department: get("department"),
        company: get("company"),
        email: get("email"),
        emailStatus: get("emailStatus"),
        phone,
        website: get("website"),
        linkedin: get("linkedin"),
        companyLinkedin: get("companyLinkedin"),
        facebook: get("facebook"),
        instagram: get("instagram"),
        twitter: get("twitter"),
        industry: get("industry"),
        keywords: splitList(get("keywords")).slice(0, 12),
        technologies: splitList(get("technologies")).slice(0, 20),
        address: get("address"),
        city: get("city"),
        state: get("state"),
        country: get("country"),
        employees: get("employees"),
        annualRevenue: get("annualRevenue"),
        totalFunding: get("totalFunding"),
        latestFunding: get("latestFunding"),
        latestFundingAmount: get("latestFundingAmount"),
        lastRaisedAt: get("lastRaisedAt"),
        notes: get("notes"),
    };
}

/** Select one record by 1-based row number, email, or company substring. */
function selectRecord(records, { row, email, company } = {}) {
    if (row) {
        const i = parseInt(row, 10) - 1;
        return records[i];
    }
    if (email) {
        const target = email.toLowerCase();
        return records.find((r) =>
            Object.values(r).some((v) => String(v).toLowerCase() === target)
        );
    }
    if (company) {
        const target = company.toLowerCase();
        return records.find((r) =>
            Object.values(r).some((v) => String(v).toLowerCase().includes(target))
        );
    }
    return records[0];
}

module.exports = { parseCSV, readCSVObjects, mapRecordToLead, selectRecord, cleanPhone, isIndexLike, isIgnoredHeader };
