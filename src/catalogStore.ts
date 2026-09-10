import type { CatalogProduct, PriceCatalog } from "./catalog.js";

// Supabase/PostgREST data access for the price store. Raw fetch, matching
// the rest of the codebase's no-SDK style — keeps dependencies at zero and
// the data layer swappable if Likho ever moves off Supabase.
//
// Uses the SERVICE ROLE key: every Likho table has RLS enabled with no
// policies (deny-all), so nothing is reachable from a browser or public
// client. Only this server-side process can read or write.
const SUPABASE_URL = process.env["SUPABASE_URL"] ?? "https://gzplynqqsmkwyrjxprai.supabase.co";
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

export async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
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
  product_aliases: { alias: string }[] | null;
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
    `business_channels?platform=eq.${platform}&platform_user_id=eq.${encodeURIComponent(platformUserId)}&select=business_id`,
  )) as BusinessChannelRow[];

  if (existing.length > 0) return existing[0]!.business_id;

  const created = (await rest("businesses", {
    method: "POST",
    body: JSON.stringify({ name: displayName }),
  })) as { id: string }[];
  const businessId = created[0]!.id;

  await rest("business_channels", {
    method: "POST",
    body: JSON.stringify({ business_id: businessId, platform, platform_user_id: platformUserId }),
  });

  return businessId;
}

export async function loadCatalog(businessId: string): Promise<PriceCatalog> {
  const rows = (await rest(
    `products?business_id=eq.${businessId}&active=is.true&select=id,name,price,product_aliases(alias)`,
  )) as ProductRow[];

  const products: CatalogProduct[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: Number(row.price),
    aliases: (row.product_aliases ?? []).map((a) => a.alias),
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
  await rest("products?on_conflict=business_id,name", {
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
    `products?business_id=eq.${businessId}&name=eq.${encodeURIComponent(name.toLowerCase().trim())}`,
    { method: "PATCH", body: JSON.stringify({ active: false }) },
  )) as unknown[];
  return Array.isArray(updated) && updated.length > 0;
}

// Renames a product, keeping its id — so every bill that already referenced
// it stays linked, and the price snapshots on those bills are untouched.
// Returns false when there is nothing by that name, or when the new name is
// already taken by a different product.
export async function renameProduct(
  businessId: string,
  from: string,
  to: string,
): Promise<"renamed" | "not_found" | "target_exists"> {
  const oldName = from.toLowerCase().trim();
  const newName = to.toLowerCase().trim();
  if (oldName === newName) return "renamed";

  const existing = (await rest(
    `products?business_id=eq.${businessId}&name=eq.${encodeURIComponent(newName)}` +
      `&active=eq.true&select=id`,
  )) as { id: string }[];
  if (existing.length > 0) return "target_exists";

  const updated = (await rest(
    `products?business_id=eq.${businessId}&name=eq.${encodeURIComponent(oldName)}&active=eq.true`,
    {
      method: "PATCH",
      body: JSON.stringify({ name: newName, updated_at: new Date().toISOString() }),
    },
  )) as { id: string }[];

  return updated.length > 0 ? "renamed" : "not_found";
}

// --- Learned aliases ------------------------------------------------------
//
// When the seller answers "which one did you mean?", the answer is SAVED.
// The word becomes an exact key on that product (buildCatalogIndex already
// indexes aliases alongside names), so the same question is never asked
// twice. This is the seller teaching their own price list — no model is
// trained and nothing is shared between businesses.

export async function addAlias(productId: string, alias: string): Promise<void> {
  await rest("product_aliases?on_conflict=product_id,alias", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ product_id: productId, alias: alias.toLowerCase().trim() }),
  });
}

// --- Pending resolution ---------------------------------------------------
//
// The order Likho could not price, held so that tapping an answer re-runs
// the ORIGINAL message rather than making the seller retype it.

export interface PendingResolution {
  message: string;
  term: string;
}

export async function setPendingResolution(
  businessId: string,
  message: string,
  term: string,
): Promise<void> {
  await rest("pending_resolutions?on_conflict=business_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      business_id: businessId,
      message,
      term,
      created_at: new Date().toISOString(),
    }),
  });
}

export async function takePendingResolution(
  businessId: string,
): Promise<PendingResolution | null> {
  const rows = (await rest(
    `pending_resolutions?business_id=eq.${businessId}&select=message,term`,
  )) as PendingResolution[];
  if (rows.length === 0) return null;

  await rest(`pending_resolutions?business_id=eq.${businessId}`, { method: "DELETE" });
  return rows[0]!;
}

export async function getProductById(
  businessId: string,
  productId: string,
): Promise<{ id: string; name: string } | null> {
  const rows = (await rest(
    `products?business_id=eq.${businessId}&id=eq.${productId}&active=eq.true&select=id,name`,
  )) as { id: string; name: string }[];
  return rows[0] ?? null;
}

// Everything this business has taught Likho. Visibility matters: a learned
// alias silently changes how future orders are priced, so the seller must
// be able to see the list and remove a wrong one.
export async function loadAliases(
  businessId: string,
): Promise<{ alias: string; productName: string }[]> {
  const rows = (await rest(
    `product_aliases?select=alias,products!inner(name,business_id,active)` +
      `&products.business_id=eq.${businessId}&products.active=eq.true&order=alias.asc`,
  )) as { alias: string; products: { name: string } }[];
  return rows.map((r) => ({ alias: r.alias, productName: r.products.name }));
}

export async function forgetAlias(businessId: string, alias: string): Promise<boolean> {
  const products = (await rest(
    `products?business_id=eq.${businessId}&select=id`,
  )) as { id: string }[];
  if (products.length === 0) return false;

  const ids = products.map((p) => p.id).join(",");
  const deleted = (await rest(
    `product_aliases?alias=eq.${encodeURIComponent(alias.toLowerCase().trim())}` +
      `&product_id=in.(${ids})`,
    { method: "DELETE", headers: { Prefer: "return=representation" } },
  )) as unknown[];
  return Array.isArray(deleted) && deleted.length > 0;
}
