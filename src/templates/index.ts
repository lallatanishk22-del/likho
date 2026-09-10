import type { BillData, TemplateId } from "../billData.js";
import { asTemplateId } from "../billData.js";
import { renderClassic } from "./classic.js";
import { renderModern } from "./modern.js";
import { renderRetail } from "./retail.js";
import { renderFood } from "./food.js";
import { renderProfessional } from "./professional.js";
import { renderReceipt } from "./receipt.js";

// The whole template layer's public surface. Adding a seventh style means
// writing one file and adding one line here — no billing code is touched,
// which is the point of separating BillData from presentation.
const RENDERERS: Record<TemplateId, (data: BillData) => string> = {
  classic: renderClassic,
  modern: renderModern,
  retail: renderRetail,
  food: renderFood,
  professional: renderProfessional,
  receipt: renderReceipt,
};

export function renderBill(data: BillData, templateId: unknown): string {
  return RENDERERS[asTemplateId(templateId)](data);
}
