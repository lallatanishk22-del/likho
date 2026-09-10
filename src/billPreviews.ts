import { TEMPLATE_IDS, TEMPLATE_LABELS, type BillData, type TemplateId } from "./billData.js";
import { SAMPLE_BILL } from "./billSamples.js";
import { renderBill } from "./templates/index.js";
import { htmlToPng } from "./billPdf.js";
import type { StoredBill } from "./billStore.js";
import type { BusinessProfile } from "./billRender.js";
import { toBillData } from "./billRender.js";

// In-chat template previews.
//
// A seller choosing how their bill looks should SEE the bill, in the same
// app, with their OWN shop name and their OWN last order on it. A list of
// six names ("Classic, Modern, Retail...") asks them to imagine six
// layouts; six pictures asks them to point at one.

export interface TemplatePreview {
  id: TemplateId;
  label: string;
  forWho: string;
  pngPath: string;
}

// Preview sizes are the bill's own proportions, cropped to the part that
// carries the design. Tall enough to show items and the total — which is
// what distinguishes the six — without wasting screen on empty page.
const WIDE = { width: 760, height: 660 };
const NARROW = { width: 420, height: 660 };

// Uses the seller's real bill when they have one, so the preview shows
// their shop and their items. Falls back to the sample for a business that
// has not billed anything yet.
export function previewData(
  business: BusinessProfile,
  lastBill: StoredBill | null,
): BillData {
  if (!lastBill || lastBill.items.length === 0) {
    return { ...SAMPLE_BILL, business: { ...SAMPLE_BILL.business, name: business.name } };
  }
  return toBillData(lastBill, business);
}

export async function renderPreviews(data: BillData): Promise<TemplatePreview[]> {
  // Rendered in parallel: six sequential Chrome launches is several seconds
  // of a seller watching a "typing" dot.
  return Promise.all(
    TEMPLATE_IDS.map(async (id) => {
      const size = id === "receipt" ? NARROW : WIDE;
      const pngPath = await htmlToPng(renderBill(data, id), `${id}`, size.width, size.height);
      return { id, label: TEMPLATE_LABELS[id].name, forWho: TEMPLATE_LABELS[id].forWho, pngPath };
    }),
  );
}
