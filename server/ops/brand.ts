import { durableReadJson, durableWriteJson } from "@/server/services/durable-store";
import { opsDir } from "./store";

export type BrandColors = {
  accent: string;
  accentSoft: string;
  ink: string;
  muted: string;
  paper: string;
  headerBg: string;
};

export type PitchBrand = {
  companyName: string;
  tagline: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  preparedBy: string;
  themeId: string;
  colors: BrandColors;
  logoDataUrl?: string;
  logoMime?: string;
};

type BrandStore = {
  default: PitchBrand;
  operators: Record<string, PitchBrand>;
};

export const BRAND_THEMES: { id: string; label: string; colors: BrandColors }[] = [
  {
    id: "teal",
    label: "Teal",
    colors: { accent: "#0e7c7b", accentSoft: "#e7f6f5", ink: "#122033", muted: "#5b6b7c", paper: "#f7f8fa", headerBg: "#0b3d3c" },
  },
  {
    id: "navy",
    label: "Navy",
    colors: { accent: "#1e4b8e", accentSoft: "#e8eef8", ink: "#102033", muted: "#5a6a7c", paper: "#f6f8fb", headerBg: "#0f2747" },
  },
  {
    id: "forest",
    label: "Forest",
    colors: { accent: "#2f6b3a", accentSoft: "#eaf5ec", ink: "#142016", muted: "#5c6b5e", paper: "#f6f8f6", headerBg: "#1a3a22" },
  },
  {
    id: "burgundy",
    label: "Burgundy",
    colors: { accent: "#8b2e3b", accentSoft: "#f8eaed", ink: "#1f1416", muted: "#6d5a5e", paper: "#faf7f7", headerBg: "#4a1820" },
  },
  {
    id: "charcoal",
    label: "Charcoal",
    colors: { accent: "#3d4654", accentSoft: "#eceef1", ink: "#12151a", muted: "#5c6570", paper: "#f5f6f8", headerBg: "#1b2028" },
  },
  {
    id: "gold",
    label: "Gold",
    colors: { accent: "#b8860b", accentSoft: "#fbf4e3", ink: "#1c1608", muted: "#6e644e", paper: "#fbf8f2", headerBg: "#3d2e0a" },
  },
];

export const DEFAULT_BRAND: PitchBrand = {
  companyName: "Outreach Action",
  tagline: "Website & conversion reviews for growing firms",
  website: "",
  email: "",
  phone: "",
  address: "",
  preparedBy: "",
  themeId: "teal",
  colors: BRAND_THEMES[0].colors,
};

const REL = "ops/brand.json";

function hydrate(raw: Partial<PitchBrand> | undefined): PitchBrand {
  const stored = raw || {};
  const theme = BRAND_THEMES.find((t) => t.id === stored.themeId) || BRAND_THEMES[0];
  return {
    ...DEFAULT_BRAND,
    ...stored,
    themeId: stored.themeId || theme.id,
    colors: stored.themeId === "custom" && stored.colors ? { ...theme.colors, ...stored.colors } : theme.colors,
  };
}

function isStore(raw: unknown): raw is BrandStore {
  return !!raw && typeof raw === "object" && "default" in (raw as object) && "operators" in (raw as object);
}

async function loadStore(): Promise<BrandStore> {
  opsDir();
  const raw = await durableReadJson<unknown>(REL, {});
  if (isStore(raw)) {
    return { default: hydrate(raw.default), operators: raw.operators || {} };
  }
  const flat = hydrate(raw as Partial<PitchBrand>);
  return { default: flat, operators: {} };
}

async function saveStore(store: BrandStore) {
  await durableWriteJson(REL, store);
}

export async function loadBrand(operatorId?: string | null): Promise<PitchBrand> {
  const store = await loadStore();
  if (operatorId && store.operators[operatorId]) return hydrate(store.operators[operatorId]);
  return store.default;
}

export async function saveBrand(patch: Partial<PitchBrand>, operatorId?: string | null): Promise<PitchBrand> {
  const store = await loadStore();
  const current = operatorId && store.operators[operatorId] ? hydrate(store.operators[operatorId]) : store.default;
  const themeId = patch.themeId || current.themeId;
  const theme = BRAND_THEMES.find((t) => t.id === themeId);
  const next: PitchBrand = {
    ...current,
    ...patch,
    themeId,
    colors:
      themeId === "custom" ? { ...current.colors, ...(patch.colors || {}) } : theme?.colors || current.colors,
  };
  if (patch.logoDataUrl === "") {
    next.logoDataUrl = undefined;
    next.logoMime = undefined;
  }
  if (operatorId) store.operators[operatorId] = next;
  else store.default = next;
  await saveStore(store);
  return next;
}

export async function deleteOperatorBrand(operatorId: string): Promise<PitchBrand> {
  const store = await loadStore();
  delete store.operators[operatorId];
  await saveStore(store);
  return store.default;
}

export async function listBrandOwners(): Promise<{ default: boolean; operatorIds: string[] }> {
  const store = await loadStore();
  return { default: true, operatorIds: Object.keys(store.operators) };
}

export function logoBuffer(brand: PitchBrand): { data: Buffer; type: "png" | "jpg" | "gif" } | null {
  const url = brand.logoDataUrl || "";
  const m = url.match(/^data:(image\/(png|jpeg|jpg|gif));base64,(.+)$/i);
  if (!m) return null;
  const subtype = m[2].toLowerCase();
  const type = subtype === "jpeg" || subtype === "jpg" ? "jpg" : subtype === "gif" ? "gif" : "png";
  return { data: Buffer.from(m[3], "base64"), type };
}
