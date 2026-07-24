/* English Tutor LMS — canonical demo dataset.
 *
 * Deterministic seed (parents, students, classes, homework, reviews, activity),
 * generated from design-reference/lib/etlms-seed.js and frozen as JSON so the
 * demo is identical everywhere. Lessons, attendance and billing are DERIVED
 * from these by src/lib/generate.ts per the CLAUDE.md tuition/revenue rules.
 */

import type { SeedData } from "./types";
import raw from "./seed-data.json";

export const SEED: SeedData = raw as unknown as SeedData;
