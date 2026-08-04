/* English Tutor LMS — shared domain types.
 *
 * Ported from design-reference/lib/etlms-types.js (JSDoc → TypeScript). Money is
 * always an integer number of VND; dates are ISO "YYYY-MM-DD"; months are
 * "YYYY-MM"; times are 24h "HH:MM". See CLAUDE.md for the tuition/revenue rules.
 */

export type StudentStatus = "Active" | "Trial" | "Paused" | "Archived";
export type AttendanceStatus = "Present" | "Absent" | "Late" | "Excused";
export type LessonType = "regular" | "makeup" | "extra";
export type LessonStatus = "Upcoming" | "Completed" | "Cancelled";
export type ClassType = "group" | "one-on-one";
export type BillingStatus = "Paid" | "Partially Paid" | "Unpaid";
export type HomeworkStatus = "Assigned" | "Completed" | "Late" | "Missing";

/** A parent/guardian contact. Students reference one via `parentId`. */
export interface Parent {
  id: string;
  name: string;
  relationship: string; // e.g. "Mother", "Guardian"
  phone: string;
  email: string;
  notes: string;
  initials: string; // derived, up to 2 chars
  color: string; // avatar tint (hex)
}

/** An enrolled student. `balance` is integer VND. */
export interface Student {
  id: string;
  first: string;
  last: string;
  name: string; // derived "first last"
  initials: string; // derived, uppercase
  birthday: string; // ISO "YYYY-MM-DD"
  age: number; // derived from birthday vs app clock
  school: string;
  grade: number; // 0 = Kindergarten
  gradeLabel: string; // derived, e.g. "Grade 3"
  parentId: string; // -> Parent.id
  parentName: string; // derived from parent
  phone: string; // independent — never copied/synced from Parent.phone; may be blank
  status: StudentStatus;
  notes: string;
  joined: string; // ISO "YYYY-MM-DD"
  classes: number; // count of enrolments
  attendance: number; // lifetime attendance %
  balance: number; // outstanding VND
  avatar: string | null; // data-URL or null
  avatarColor: string; // hex tint
}

/** A recurring weekly slot on a class schedule. */
export interface ScheduleSlot {
  day: number; // 0 (Sun) .. 6 (Sat)
  start: string; // 24h "HH:MM"
  duration: number; // minutes
}

/** A free window the scheduler offers for a slot, as From / To wall-clock times. */
export interface TimeSuggestion {
  start: string; // 24h "HH:MM"
  end: string; // 24h "HH:MM"
}

/** An Active class already teaching at a proposed weekday + time range. Read-only
 * preview of the overlap rule the API enforces on save (see lib/classes). */
export interface ScheduleConflict {
  classId: string;
  name: string;
  level: string;
  day: number; // 0 (Sun) .. 6 (Sat)
  start: string; // 24h "HH:MM"
  end: string; // 24h "HH:MM"
}

/** Answer to "when is the teacher free?" for a proposed set of weekdays. */
export interface ScheduleAvailability {
  conflicts: ScheduleConflict[];
  suggestions: TimeSuggestion[];
}

/** A class (group or one-on-one). `fee` is the integer VND monthly fee. */
export interface Klass {
  id: string;
  name: string;
  type: ClassType;
  level: string;
  fee: number; // monthly fee, VND
  classroom: string;
  status: "Active" | "Archived";
  studentIds: string[]; // -> Student.id[]
  notes: string;
  schedule: ScheduleSlot[];
  color: string; // hex tint
}

/** A single lesson instance. Regular lessons are generated from a class's schedule.
 *
 * `originalDate` / `originalStart` / `originalDuration` record where the lesson
 * was BEFORE it was first moved — the slot its class schedule generated it into.
 * They are stamped once, on the first reschedule, and cleared again if the lesson
 * is moved back, so "is this rescheduled?" is answered by the lesson's own data
 * and never derived from the Class. Absent on a lesson that has never moved. */
export interface Lesson {
  id: string;
  classId: string; // -> Klass.id
  type: LessonType;
  date: string; // ISO "YYYY-MM-DD"
  start: string; // 24h "HH:MM"
  duration: number; // minutes
  classroom: string;
  status: LessonStatus;
  chargeable?: boolean; // cancelled-but-billed override
  fromId?: string | null; // makeup: the cancelled lesson replaced
  notes?: string;
  originalDate?: string | null; // ISO "YYYY-MM-DD" — set once, on first reschedule
  originalStart?: string | null; // 24h "HH:MM"
  originalDuration?: number | null; // minutes
  /** When the lesson was LAST moved — a full ISO 8601 instant (UTC), not a
   * calendar date, because this records an action rather than a slot. Rewritten
   * by every move and cleared alongside the origin fields when a lesson is moved
   * back. Deliberately records no actor: who did it is a later concern, and a
   * half-filled audit trail is worse than an honest timestamp. */
  rescheduledAt?: string | null;
}

export interface AttendanceEntry {
  status: AttendanceStatus;
  note?: string;
}

/** Per-student attendance for one lesson. Attendance always belongs to a Lesson. */
export interface AttendanceRecord {
  lessonId: string; // -> Lesson.id
  date: string; // ISO, mirrors the lesson
  entries: Record<string, AttendanceEntry>; // keyed by Student.id
}

/** A monthly tuition bill for one student. Amounts are integer VND. */
export interface Billing {
  id: string;
  studentId: string; // -> Student.id
  classId: string; // -> Klass.id
  month: string; // "YYYY-MM"
  fee: number; // amount due, VND
  status: BillingStatus;
  paidDate: string | null; // ISO or null
  notes?: string;
}

/** A payment applied against a bill (the pay-drawer form shape). */
export interface Payment {
  id: string; // -> Billing.id being settled
  status: BillingStatus;
  paidDate: string; // ISO "YYYY-MM-DD"
  amount?: number; // VND collected (derived for partials)
  notes: string;
}

/** A homework assignment. */
export interface Homework {
  id: string;
  title: string;
  description: string;
  classId: string; // -> Klass.id
  lessonId: string | null; // -> Lesson.id or null
  scope: "class" | "student";
  studentId: string | null; // set when scope === 'student'
  dueDate: string; // ISO "YYYY-MM-DD"
  status: HomeworkStatus;
  submissions: Record<string, HomeworkStatus>;
  teacherNotes: string;
  createdAt: string; // ISO "YYYY-MM-DD"
}

/** A monthly performance review. `skills` scores each dimension 1-5. */
export interface Review {
  id: string;
  studentId: string; // -> Student.id
  month: string; // "YYYY-MM"
  skills: Record<string, number>; // dimension key -> 1..5
  comment: string;
  strengths: string;
  improvements: string;
  goals: string;
  parentNotes: string;
}

export interface ActivityItem {
  id: string;
  type: string;
  pre: string;
  strong: string;
  post: string;
  ago: string;
}

/** Computed revenue for a month (see computeRevenue()). */
export interface RevenueByType {
  regular: number;
  makeup: number;
  extra: number;
}

export interface RevenueResult {
  total: number; // VND
  perClass: Array<{ classId: string; name: string; amount: number }>;
  byType: RevenueByType;
}

/** The full seed payload returned by buildSeed(). */
export interface SeedData {
  parents: Parent[];
  students: Student[];
  classes: Klass[];
  homework: Homework[];
  reviews: Review[];
  activity: ActivityItem[];
}

/** Regional/format + language preferences (Settings). */
export interface RegionalConfig {
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY/MM/DD";
  timeFormat: "24h" | "12h";
  currency: "VND" | "USD";
  numberFormat: "comma" | "dot";
}

export type Lang = "vi" | "en";

/** Appearance preferences (Settings). */
export interface Appearance {
  theme: "light" | "dark";
  accent: "crimson" | "indigo" | "emerald" | "slate";
  surface: "soft" | "flat" | "elevated";
  spacing: "cozy" | "airy" | "tight";
}
