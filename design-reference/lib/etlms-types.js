/* English Tutor LMS — shared JSDoc type definitions (RC2 Fix C)
 *
 * This module contains NO runtime code — only `@typedef` declarations. It exists
 * so editors (VS Code, WebStorm) and `tsc --checkJs` can surface autocomplete
 * and type errors across the plain-JS codebase without a build step or a switch
 * to TypeScript (which the component runtime does not support).
 *
 * The domain records below are the ad-hoc object literals passed around by the
 * component and the lib modules. Money is always an integer number of VND
 * (never a formatted string); dates are ISO "YYYY-MM-DD"; months are "YYYY-MM";
 * times are 24h "HH:MM". See CLAUDE.md for the tuition/revenue rules.
 *
 * Load this before the other lib modules purely for editor ergonomics; it has
 * no side effects.
 */

/**
 * @typedef {'Active'|'Trial'|'Paused'|'Archived'} StudentStatus
 * @typedef {'Present'|'Absent'|'Late'|'Excused'} AttendanceStatus
 * @typedef {'regular'|'makeup'|'extra'} LessonType
 * @typedef {'Upcoming'|'Completed'|'Cancelled'} LessonStatus
 * @typedef {'group'|'one-on-one'} ClassType
 * @typedef {'Paid'|'Partially Paid'|'Unpaid'} BillingStatus
 * @typedef {'Assigned'|'Completed'|'Late'|'Missing'} HomeworkStatus
 */

/**
 * A parent/guardian contact. Students reference one via `parentId`.
 * @typedef {Object} Parent
 * @property {string}  id
 * @property {string}  name
 * @property {string}  relationship          e.g. "Mother", "Guardian"
 * @property {string}  phone
 * @property {string}  email
 * @property {string}  notes
 * @property {string}  initials              derived, up to 2 chars
 * @property {string}  color                 avatar tint (hex)
 */

/**
 * An enrolled student. `fee`/`balance` are integer VND.
 * @typedef {Object} Student
 * @property {string}        id
 * @property {string}        first
 * @property {string}        last
 * @property {string}        name            derived "first last"
 * @property {string}        initials        derived, uppercase
 * @property {string}        birthday        ISO "YYYY-MM-DD"
 * @property {number}        age             derived from birthday vs app clock
 * @property {string}        school
 * @property {number}        grade           0 = Kindergarten
 * @property {string}        gradeLabel      derived, e.g. "Grade 3"
 * @property {string}        parentId        -> Parent.id
 * @property {string}        parentName      derived from parent
 * @property {string}        phone           derived from parent
 * @property {StudentStatus} status
 * @property {string}        notes
 * @property {string}        joined          ISO "YYYY-MM-DD"
 * @property {number}        classes         count of enrolments
 * @property {number}        attendance      lifetime attendance %
 * @property {number}        balance         outstanding VND
 * @property {?string}       avatar          data-URL or null
 * @property {string}        avatarColor     hex tint
 */

/**
 * A recurring weekly slot on a class schedule.
 * @typedef {Object} ScheduleSlot
 * @property {number} day        0 (Sun) .. 6 (Sat)
 * @property {string} start      24h "HH:MM"
 * @property {number} duration   minutes
 */

/**
 * A class (group or one-on-one). `fee` is the integer VND monthly fee.
 * @typedef {Object} Klass
 * @property {string}         id
 * @property {string}         name
 * @property {ClassType}      type
 * @property {string}         level
 * @property {number}         fee                 monthly fee, VND
 * @property {string}         classroom
 * @property {StudentStatus}  status              'Active' | 'Archived'
 * @property {string[]}       studentIds          -> Student.id[]
 * @property {string}         notes
 * @property {ScheduleSlot[]} schedule
 * @property {string}         color               hex tint
 */

/**
 * A single lesson instance. Regular lessons are generated from a class's
 * schedule; makeup/extra are created ad hoc (see CLAUDE.md).
 * @typedef {Object} Lesson
 * @property {string}       id
 * @property {string}       classId        -> Klass.id
 * @property {LessonType}   type
 * @property {string}       date           ISO "YYYY-MM-DD"
 * @property {string}       start          24h "HH:MM"
 * @property {number}       duration       minutes
 * @property {string}       classroom
 * @property {LessonStatus} status
 * @property {boolean}      [chargeable]   cancelled-but-billed override
 * @property {?string}      [fromId]       makeup: the cancelled lesson replaced
 * @property {string}       [notes]
 */

/**
 * Per-student attendance for one lesson. Attendance always belongs to a Lesson.
 * @typedef {Object} AttendanceEntry
 * @property {AttendanceStatus} status
 * @property {string}           [note]
 *
 * @typedef {Object} AttendanceRecord
 * @property {string} lessonId                          -> Lesson.id
 * @property {string} date                              ISO, mirrors the lesson
 * @property {Object.<string, AttendanceEntry>} entries keyed by Student.id
 */

/**
 * A monthly tuition bill for one student. Amounts are integer VND.
 * @typedef {Object} Billing
 * @property {string}        id
 * @property {string}        studentId    -> Student.id
 * @property {string}        classId      -> Klass.id
 * @property {string}        month        "YYYY-MM"
 * @property {number}        fee          amount due, VND
 * @property {BillingStatus} status
 * @property {?string}       paidDate     ISO or null
 * @property {string}        [notes]
 */

/**
 * A payment applied against a bill (the pay-drawer form shape).
 * @typedef {Object} Payment
 * @property {string}        id           -> Billing.id being settled
 * @property {BillingStatus} status
 * @property {string}        paidDate     ISO "YYYY-MM-DD"
 * @property {number}        [amount]     VND collected (derived for partials)
 * @property {string}        notes
 */

/**
 * A homework assignment. `scope` selects whom it targets; `submissions` maps
 * Student.id -> HomeworkStatus for class-scoped work.
 * @typedef {Object} Homework
 * @property {string}         id
 * @property {string}         title
 * @property {string}         description
 * @property {string}         classId               -> Klass.id
 * @property {?string}        lessonId              -> Lesson.id or null
 * @property {'class'|'student'} scope
 * @property {?string}        studentId             set when scope === 'student'
 * @property {string}         dueDate               ISO "YYYY-MM-DD"
 * @property {HomeworkStatus} status
 * @property {Object.<string, HomeworkStatus>} submissions
 * @property {string}         teacherNotes
 * @property {string}         createdAt             ISO "YYYY-MM-DD"
 */

/**
 * A monthly performance review. `skills` scores each dimension 1-5.
 * @typedef {Object} Review
 * @property {string} id
 * @property {string} studentId                 -> Student.id
 * @property {string} month                     "YYYY-MM"
 * @property {Object.<string, number>} skills   dimension key -> 1..5
 * @property {string} comment
 * @property {string} strengths
 * @property {string} improvements
 * @property {string} goals
 * @property {string} parentNotes
 */

/**
 * Computed revenue for a month (see component computeRevenue()).
 * @typedef {Object} RevenueByType
 * @property {number} regular
 * @property {number} makeup
 * @property {number} extra
 *
 * @typedef {Object} RevenueResult
 * @property {number} total                                    VND
 * @property {Array.<{classId:string, name:string, amount:number}>} perClass
 * @property {RevenueByType} byType
 */

/**
 * The full seed payload returned by ETLMS.seed().
 * @typedef {Object} SeedData
 * @property {Parent[]}   parents
 * @property {Student[]}  students
 * @property {Klass[]}    classes
 * @property {Homework[]} homework
 * @property {Review[]}   reviews
 * @property {Array<Object>} activity
 */
