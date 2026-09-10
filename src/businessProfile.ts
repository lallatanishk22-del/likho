import { rest } from "./catalogStore.js";
import type { BusinessProfile } from "./billRender.js";
import { asTemplateId, type TemplateId } from "./billData.js";
import { asOnboardingStep, type OnboardingStep } from "./onboarding.js";

// Reading and writing the business's own details and chosen bill style.
// Separate from catalogStore because that file is about products; this is
// about who the business IS, which is what appears at the top of a bill.

interface BusinessRow {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  upi_id: string | null;
  logo_url: string | null;
  footer_note: string | null;
  bill_template: string | null;
  onboarding_step: string | null;
  business_kind: string | null;
}

export async function loadBusinessProfile(businessId: string): Promise<BusinessProfile> {
  const rows = (await rest(
    `businesses?id=eq.${businessId}&limit=1&select=*`,
  )) as BusinessRow[];
  const row = rows[0];

  // A business always exists by the time this is called; the fallback keeps
  // a bill renderable rather than throwing during a seller's billing flow.
  if (!row) {
    return { id: businessId, name: "My Business", billTemplate: "classic" };
  }

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    gstin: row.gstin,
    upiId: row.upi_id,
    logoUrl: row.logo_url,
    footerNote: row.footer_note,
    billTemplate: asTemplateId(row.bill_template),
  };
}

export async function setBillTemplate(businessId: string, template: TemplateId): Promise<void> {
  await rest(`businesses?id=eq.${businessId}`, {
    method: "PATCH",
    body: JSON.stringify({ bill_template: template }),
  });
}

// Business details a seller can set from chat. Only these keys are
// writable, so a typo in a command can never reach an unrelated column.
const EDITABLE: Record<string, keyof BusinessRow> = {
  name: "name",
  phone: "phone",
  address: "address",
  gstin: "gstin",
  upi: "upi_id",
  logo: "logo_url",
  note: "footer_note",
};

export function isEditableField(field: string): boolean {
  return Object.hasOwn(EDITABLE, field.toLowerCase());
}

export const EDITABLE_FIELDS = Object.keys(EDITABLE);

export async function setBusinessField(
  businessId: string,
  field: string,
  value: string,
): Promise<boolean> {
  const column = EDITABLE[field.toLowerCase()];
  if (!column) return false;
  const trimmed = value.trim();
  await rest(`businesses?id=eq.${businessId}`, {
    method: "PATCH",
    // An empty value clears the field, which is how a seller removes a
    // GSTIN or a note without needing a separate command.
    body: JSON.stringify({ [column]: trimmed.length > 0 ? trimmed : null }),
  });
  return true;
}

// --- Onboarding state -----------------------------------------------------
//
// Kept on the business rather than in memory because setup is a
// conversation the seller can walk away from. Closing Telegram halfway
// through and coming back tomorrow must resume, not restart.

export interface OnboardingState {
  step: OnboardingStep;
  kindId: string | null;
  name: string;
}

export async function loadOnboarding(businessId: string): Promise<OnboardingState> {
  const rows = (await rest(
    `businesses?id=eq.${businessId}&limit=1&select=name,onboarding_step,business_kind`,
  )) as { name: string; onboarding_step: string | null; business_kind: string | null }[];
  const row = rows[0];

  // No row means something is wrong upstream, not that a new seller needs
  // setting up. Never open a questionnaire on the strength of a failed read.
  if (!row) return { step: "done", kindId: null, name: "My Business" };

  return {
    step: asOnboardingStep(row.onboarding_step),
    kindId: row.business_kind,
    name: row.name,
  };
}

export async function setOnboardingStep(
  businessId: string,
  step: OnboardingStep,
): Promise<void> {
  await rest(`businesses?id=eq.${businessId}`, {
    method: "PATCH",
    body: JSON.stringify({ onboarding_step: step }),
  });
}

// The kind and the bill style it implies are written together: the style
// is the only reason the question is worth asking, so they must never
// disagree.
export async function setBusinessKind(
  businessId: string,
  kindId: string,
  template: TemplateId,
): Promise<void> {
  await rest(`businesses?id=eq.${businessId}`, {
    method: "PATCH",
    body: JSON.stringify({ business_kind: kindId, bill_template: template }),
  });
}
