// Maps each subject to the study semester it is taught in. The question bank
// itself carries no study-semester data (its `topic`/`source`/`tags` only encode
// the exam term, e.g. "SS 18"), so this mapping is the single source of truth for
// the semester-first Papers view. It mirrors the source site's "Fragenauswahl"
// layout (Vorklinik, Semester 5-9). Edit this map to re-bucket subjects.

export type CurriculumSemester = {
  key: string;
  label: string;
  sort: number;
};

export const CURRICULUM_SEMESTERS: CurriculumSemester[] = [
  { key: "vorklinik", label: "Vorklinik", sort: 0 },
  { key: "sem-5", label: "Semester 5", sort: 5 },
  { key: "sem-6", label: "Semester 6", sort: 6 },
  { key: "sem-7", label: "Semester 7", sort: 7 },
  { key: "sem-8", label: "Semester 8", sort: 8 },
  { key: "sem-9", label: "Semester 9", sort: 9 }
];

export const UNASSIGNED_SEMESTER: CurriculumSemester = {
  key: "unassigned",
  label: "Unassigned",
  sort: 999
};

// Subject name -> semester key. Subject strings match the bank exactly, including
// the bank's spelling of "Immunulogie". Anything not listed here falls into the
// Unassigned group at the bottom of the view.
const SUBJECT_SEMESTER: Record<string, string> = {
  // Vorklinik
  Biochemie: "vorklinik",
  Physiologie: "vorklinik",

  // Semester 5
  Arbeitsmedizin: "sem-5",
  "Klinische Chemie": "sem-5",
  Mikrobiologie: "sem-5",
  Pathologie: "sem-5",
  "Pharmakologie 1": "sem-5",
  "Prävention, Gesundheitsförderung": "sem-5",

  // Semester 6
  Epidemiologie: "sem-6",
  "GTE Geschichte Theorie Ethik": "sem-6",
  Hygiene: "sem-6",
  Immunulogie: "sem-6",
  "Klinisch-pathologische Konferenz": "sem-6",
  "Neurologie 1": "sem-6",
  "Pharmakologie 2": "sem-6",
  "Psychiatrie 1": "sem-6",
  Rechtsmedizin: "sem-6",

  // Semester 7
  "Bildgebende Verfahren, Strahlenbehandlung": "sem-7",
  Chirurgie: "sem-7",
  "Gesundheitsökonomie, Gesundheitssystem": "sem-7",
  Infektiologie: "sem-7",
  "Innere Medizin": "sem-7",
  "Neurologie 2": "sem-7",
  "Psychiatrie 2": "sem-7",

  // Semester 8
  Allgemeinmedizin: "sem-8",
  "Dermatologie, Venerologie": "sem-8",
  "Frauenheilkunde, Geburtshilfe": "sem-8",
  Humangenetik: "sem-8",
  Kinderheilkunde: "sem-8",
  "Klinische Pharmakologie": "sem-8",
  "Klinische Umweltmedizin": "sem-8",
  Palliativmedizin: "sem-8",
  "Rehabilitation, physik. Medizin": "sem-8",
  Schmerzmedizin: "sem-8",
  Sozialmedizin: "sem-8",

  // Semester 9
  Anästhesiologie: "sem-9",
  Augenheilkunde: "sem-9",
  "HNO Hals Nasen Ohren": "sem-9",
  "Medizin des Alterns": "sem-9",
  Notfallmedizin: "sem-9",
  Orthopädie: "sem-9",
  "Psychosomatische Medizin": "sem-9",
  Urologie: "sem-9"
};

function normalizeSubject(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("de");
}

// Normalized lookup so small whitespace/case variations in the bank still match.
const NORMALIZED_SUBJECT_SEMESTER = new Map(
  Object.entries(SUBJECT_SEMESTER).map(([subject, key]) => [
    normalizeSubject(subject),
    key
  ])
);

const SEMESTER_BY_KEY = new Map(
  [...CURRICULUM_SEMESTERS, UNASSIGNED_SEMESTER].map((semester) => [
    semester.key,
    semester
  ])
);

export function semesterForSubject(subject: string): CurriculumSemester {
  const key = NORMALIZED_SUBJECT_SEMESTER.get(normalizeSubject(subject));

  return (key && SEMESTER_BY_KEY.get(key)) || UNASSIGNED_SEMESTER;
}
