export type Choice = {
  id: string;
  text: string;
};

export type Difficulty = "easy" | "medium" | "hard";

// "freeText" questions have no answer choices on the source site — just a
// written model answer (essay/explain-the-mechanism style questions, common in
// Pharmakologie). They render as stem + reveal instead of A-E choices.
export type QuestionKind = "mcq" | "freeText";

// Aggregate answer statistics from the source site (how the whole user base did).
export type QuestionStats = {
  answered: number;
  correct: number;
  choices: { id: string; count: number }[];
};

export type Question = {
  id: string;
  subject: string;
  topic: string;
  source?: string;
  stem: string;
  imageUrl?: string;
  kind?: QuestionKind;
  choices: Choice[];
  answer: string;
  modelAnswer?: string;
  explanation?: string;
  notes?: string[];
  tags?: string[];
  difficulty?: Difficulty;
  stats?: QuestionStats;
};

export type QuestionMetrics = {
  questions: number;
  subjects: number;
  notes: number;
  images: number;
};

// Lightweight metadata for the Papers/Dashboard views. The full stem/choices/
// explanation/notes are fetched separately (or via the full bank in background).
export type QuestionIndex = {
  id: string;
  subject: string;
  topic: string;
  source?: string;
  kind?: QuestionKind;
};

export type StoredAnswer = {
  // For freeText questions, "answering" means revealing the model answer:
  // selected/correct are omitted, only the interaction (attempts/answeredAt)
  // and self-assessed confidence are tracked. correct stays undefined rather
  // than false so freeText reveals never count as mistakes or hurt accuracy.
  selected?: string;
  correct?: boolean;
  attempts: number;
  answeredAt: string;
  mode?: "study" | "exam";
  confidence?: "low" | "medium" | "high";
};

export type BookmarkFolder = {
  id: string;
  name: string;
  color: string;
  questionIds: string[];
  createdAt: string;
};

export type StoredProgress = {
  answers: Record<string, StoredAnswer>;
  bookmarks: string[];
  bookmarkFolders?: BookmarkFolder[];
  activeFolderId?: string;
  sessionLog?: StudySessionLog[];
  updatedAt?: string;
};

export type SessionSource = {
  paperKey?: string;
  semester?: string;
  subject?: string;
  topic?: string;
  pool?: string;
  order?: string;
};

export type StudySessionLog = {
  id: string;
  mode: "study" | "exam" | "review";
  label: string;
  questionIds: string[];
  answered: number;
  correct: number;
  mistakeQuestionIds?: string[];
  startedAt: string;
  finishedAt: string;
  // Explicitly closed by the user (or by submitting/finishing). A session is
  // resumable only while it is not closed and has unanswered questions.
  closed?: boolean;
  source?: SessionSource;
};

// One exam sitting: a single subject in a single exam term (e.g. "Chirurgie" /
// "WS 20/21"). The smallest startable unit in the Papers view.
export type PaperSummary = {
  key: string;
  subject: string;
  semesterKey: string;
  semesterLabel: string;
  examTerm: string;
  examTermSort: number;
  questionIds: string[];
  total: number;
  answered: number;
  solved: boolean;
  latestScore: number | null;
  recentScores: number[];
};

// A subject within a study semester, aggregating all of its exam-term papers.
export type SubjectSummary = {
  key: string;
  subject: string;
  semesterKey: string;
  semesterLabel: string;
  total: number;
  answered: number;
  solved: boolean;
  latestScore: number | null;
  recentScores: number[];
  papers: PaperSummary[];
};

// A study semester (Vorklinik, Semester 5-9, …) and the subjects it contains.
export type SemesterGroup = {
  key: string;
  label: string;
  sort: number;
  subjects: SubjectSummary[];
  total: number;
  subjectCount: number;
};

export type TrainerUser = {
  id: string;
  name: string;
  role: "admin" | "member";
  disabled?: boolean;
  managed?: boolean;
};

export type ManagedTrainerUser = TrainerUser & {
  password: string;
  createdAt?: string;
};

export type QuestionReport = {
  id: string;
  questionId: string;
  userId: string;
  type: "wrong-answer" | "typo" | "unclear" | "other";
  text: string;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt?: string;
  resolution?: string;
};

export type LeaderboardEntry = {
  userId: string;
  name: string;
  answered: number;
  correct: number;
  accuracy: number;
  weeklyAnswered: number;
};
