/**
 * AID-26: Backlog Classification Model & Provenance Schema
 *
 * Every recovered backlog item must receive exactly one classification label
 * from the 10-label taxonomy defined in the bootstrap mandate, plus a full
 * provenance record. This schema is the single source of truth for
 * classification — consumed by Conductor, roadmap prioritisation, and
 * owner-facing reports.
 *
 * Branch: aid/aid-26
 * Model: glm-5.2:cloud (Ollama) + manual PM judgment
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// 10-Label Taxonomy
// ---------------------------------------------------------------------------

/**
 * CURRENT_VERIFIED — Item exists in running codebase, verified against
 *   current evidence (runtime, repo, DB). No owner decision needed.
 * ACTIVE_RELEVANT — Item is still relevant and desired, but not yet
 *   verified against current runtime. Needs verification before promotion.
 * KEEP_BACKLOG — Item is still relevant as a backlog entry but has not
 *   been started and is not immediately prioritised. Keep for roadmap.
 * DONE_ARCHIVE — Item was completed. Evidence of completion exists.
 *   Archive; do not re-activate.
 * OWNER_DECISION_REQUIRED — Item cannot be classified without an explicit
 *   owner decision. Evidence is conflicting or incomplete.
 * NEEDS_RECOVERY — Source material exists but is inaccessible, corrupted,
 *   or ambiguous. Recovery effort needed before classification.
 * CONFLICTED — Multiple sources contradict each other. Resolution requires
 *   human judgment or additional evidence.
 * STALE_CANDIDATE — Item appears outdated but cannot be confirmed
 *   superseded. Needs one more verification pass before demotion.
 * SUPERSEDED — Item has been replaced by a newer item, architecture
 *   change, or owner decision. Superseded_by field must reference the
 *   replacement.
 * DROP_RECOMMENDED — Item is obsolete, redundant, or contradicts current
 *   owner direction. PM recommends dropping; owner can override.
 */
export const BacklogLabel = z.enum([
  "CURRENT_VERIFIED",
  "ACTIVE_RELEVANT",
  "KEEP_BACKLOG",
  "DONE_ARCHIVE",
  "OWNER_DECISION_REQUIRED",
  "NEEDS_RECOVERY",
  "CONFLICTED",
  "STALE_CANDIDATE",
  "SUPERSEDED",
  "DROP_RECOMMENDED",
]);
export type BacklogLabel = z.infer<typeof BacklogLabel>;

// ---------------------------------------------------------------------------
// Provenance fields (per bootstrap mandate)
// ---------------------------------------------------------------------------

export const ProvenanceRecord = z.object({
  /** What source document/system did this classification come from? */
  source: z.string().min(1),
  /** Date the source was created or last updated (ISO 8601). */
  sourceDate: z.string().datetime(),
  /** Date this classification was made (ISO 8601). */
  classifiedAt: z.string().datetime(),
  /** Who or what made this classification? "PM", "conductor", "owner", etc. */
  classifiedBy: z.string().min(1),
  /** 0–1 confidence in the classification. 1 = verified by current evidence. */
  confidence: z.number().min(0).max(1),
  /** URL, file path, or ledger reference to the evidence supporting this label. */
  evidence: z.array(z.string()),
  /** For SUPERSEDED only: reference to the item that replaces this one. */
  supersededBy: z.string().optional(),
  /** Items this item depends on (issue IDs, task IDs, or external refs). */
  dependencies: z.array(z.string()).default([]),
  /** Does this item require an owner gate before promotion? */
  ownerGate: z.boolean().default(false),
  /** What further evidence is needed to raise confidence? */
  nextEvidence: z.array(z.string()).default([]),
});
export type ProvenanceRecord = z.infer<typeof ProvenanceRecord>;

// ---------------------------------------------------------------------------
// Backlog Item (full record)
// ---------------------------------------------------------------------------

export const BacklogItem = z.object({
  /** Unique identifier (matches Paperclip issue ID or bootstrap-assigned ID). */
  id: z.string().min(1),
  /** Human-readable title. */
  title: z.string().min(1),
  /** Category from the historical ~46-item taxonomy. */
  category: z.string().min(1),
  /** The 10-label classification. */
  label: BacklogLabel,
  /** Provenance record. */
  provenance: ProvenanceRecord,
  /** Free-form notes explaining the classification decision. */
  rationale: z.string().default(""),
  /** Original historical description or claim. */
  historicalDescription: z.string().default(""),
  /** Current evidence summary (what we checked, what we found). */
  currentEvidenceSummary: z.string().default(""),
});
export type BacklogItem = z.infer<typeof BacklogItem>;

// ---------------------------------------------------------------------------
// Classification Result (full file)
// ---------------------------------------------------------------------------

export const BacklogClassification = z.object({
  /** Schema version. Increment when taxonomy changes. */
  version: z.literal(1),
  /** ISO 8601 timestamp of the full classification run. */
  classifiedAt: z.string().datetime(),
  /** Model/endpoint used for assisted classification. */
  model: z.string().min(1),
  /** All backlog items with their classifications. */
  items: z.array(BacklogItem),
  /** Summary statistics: count per label. */
  summary: z.record(BacklogLabel, z.number()),
});
export type BacklogClassification = z.infer<typeof BacklogClassification>;

// ---------------------------------------------------------------------------
// Reconciliation policy (from bootstrap mandate §RECONCILIATION POLICY)
// ---------------------------------------------------------------------------

export const RECONCILIATION_PRIORITY = [
  "current_runtime_evidence",
  "recent_owner_decision",
  "independent_artifact_evidence",
  "recent_handoff",
  "older_roadmap_or_report",
  "memory_or_recollection",
] as const;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Validate a full classification file. */
export function validateClassification(data: unknown): BacklogClassification {
  return BacklogClassification.parse(data);
}

/** Validate a single item. */
export function validateItem(data: unknown): BacklogItem {
  return BacklogItem.parse(data);
}

/** Check that every label appears in summary (even with count 0). */
export function summaryIsComplete(summary: Record<string, number>): boolean {
  const allLabels: BacklogLabel[] = BacklogLabel.options;
  return allLabels.every((l) => typeof summary[l] === "number");
}

/** Check that no SUPERSEDED item lacks a supersededBy reference. */
export function supersededHasReference(items: BacklogItem[]): boolean {
  return items
    .filter((i) => i.label === "SUPERSEDED")
    .every((i) => i.provenance.supersededBy && i.provenance.supersededBy.length > 0);
}

/** Check that every OWNER_DECISION_REQUIRED item has ownerGate = true. */
export function ownerGateConsistent(items: BacklogItem[]): boolean {
  return items
    .filter((i) => i.label === "OWNER_DECISION_REQUIRED")
    .every((i) => i.provenance.ownerGate === true);
}

/** Check confidence ranges are valid. */
export function confidenceInRange(items: BacklogItem[]): boolean {
  return items.every((i) => i.provenance.confidence >= 0 && i.provenance.confidence <= 1);
}