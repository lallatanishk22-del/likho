import type { CatalogProduct, PriceCatalog } from "./catalog.js";

// Supabase/PostgREST data access for the price store. Raw fetch, matching
// the rest of the codebase's no-SDK style — keeps dependencies at zero and
// the data layer swappable if Likho ever moves off Supabase.
//
// Uses the SERVICE ROLE key: every Likho table has RLS enabled with no
// policies (deny-all), so nothing is reachable from a browser or public
// client. Only this server-side process can read or write.
const SUPABASE_URL = process.env["SUPABASE_URL"] ?? "https://ylwgvotofppgjwwkexsi.supabase.co";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];

function requireKey(): string {
  if (!SERVICE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Get it from your Supabase dashboard " +
        "(Project Settings → API → service_role) and export it before running.",
    );
  }
  return SERVICE_KEY;
}

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
  const key = requireKey();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${text}`);
  }
  return text.length > 0 ? JSON.parse(text) : null;
}

interface BusinessChannelRow {
  business_id: string;
}

interface ProductRow {
  id: string;
  name: string;
  price: string | number;
  likho_product_aliases: { alias: string }[] | null;
}

// Resolves a platform user (Telegram chat id today, WhatsApp number later)
// to a Likho business, creating one on first contact so a new seller can
// start using the bot without any manual setup step.
export async function getOrCreateBusinessForChannel(
  platform: "telegram" | "whatsapp",
  platformUserId: string,
  displayName: string,
): Promise<string> {
  const existing = (await rest(
    `likho_business_channels?platform=eq.${platform}&platform_user_id=eq.${encodeURIComponent(platformUserId)}&select=business_id`,
  )) as BusinessChannelRow[];

  if (existing.length > 0) return existing[0]!.business_id;

  const created = (await rest("likho_businesses", {
    method: "POST",
    body: JSON.stringify({ name: displayName }),
  })) as { id: string }[];
  const businessId = created[0]!.id;

  await rest("likho_business_channels", {
    method: "POST",
    body: JSON.stringify({ business_id: businessId, platform, platform_user_id: platformUserId }),
  });

  return businessId;
}

export async function loadCatalog(businessId: string): Promise<PriceCatalog> {
  const rows = (await rest(
    `likho_products?business_id=eq.${businessId}&active=is.true&select=id,name,price,likho_product_aliases(alias)`,
  )) as ProductRow[];

  const products: CatalogProduct[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: Number(row.price),
    aliases: (row.likho_product_aliases ?? []).map((a) => a.alias),
  }));

  return { businessId, products };
}

// Upsert by (business_id, name) so re-adding an existing product updates
// its price rather than erroring — that's what a seller means by
// "paneer 130" after previously setting 120.
export async function upsertProduct(
  businessId: string,
  name: string,
  price: number,
): Promise<void> {
  await rest("likho_products?on_conflict=business_id,name", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      business_id: businessId,
      name: name.toLowerCase().trim(),
      price,
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function deactivateProduct(businessId: string, name: string): Promise<boolean> {
  const updated = (await rest(
    `likho_products?business_id=eq.${businessId}&name=eq.${encodeURIComponent(name.toLowerCase().trim())}`,
    { method: "PATCH", body: JSON.stringify({ active: false }) },
  )) as unknown[];
  return Array.isArray(updated) && updated.length > 0;
}
