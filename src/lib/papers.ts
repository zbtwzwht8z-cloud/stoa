import {
  CURRICULUM_SEMESTERS,
  UNASSIGNED_SEMESTER,
  semesterForSubject
} from "./curriculum";
import { semesterInfoFromText } from "./semesters";
import type {
  PaperSummary,
  Question,
  SemesterGroup,
  StoredProgress,
  StudySessionLog,
  SubjectSummary
} from "./types";

export type { PaperSummary } from "./types";

const OTHER_TERM_LABEL = "Sonstige";

function cleanText(value?: string) {
  return value?.replace(/\s+/g, " ").trim() || "";
}

// The exam term a question belongs to. Topic is the primary signal ("SS 18",
// "WS 20/21", "Moodle Fragen SS 24", …); when it can't be parsed as a term we
// keep the raw label, falling back to "Sonstige" for subject-name placeholders.
function examTermInfo(question: Question) {
  const topic = cleanText(question.topic);
  const info = semesterInfoFromText(topic) || semesterInfoFromText(question.source);

  if (info) {
    return { key: info.key, label: info.label, sort: info.sort };
  }

  const subject = cleanText(question.subject);
  const label =
    topic && topic.toLocaleLowerCase("de") !== subject.toLocaleLowerCase("de")
      ? topic
      : OTHER_TERM_LABEL;

  return {
    key: `raw:${label.toLocaleLowerCase("de")}`,
    label,
    sort: Number.NEGATIVE_INFINITY
  };
}

export function paperKeyForQuestion(question: Question) {
  const subjectKey = cleanText(question.subject).toLocaleLowerCase("de");

  return `${subjectKey}::${examTermInfo(question).key}`;
}

export function isCompletedSession(session: StudySessionLog) {
  return (
    session.questionIds.length > 0 &&
    session.answered >= session.questionIds.length &&
    Boolean(session.finishedAt)
  );
}

export function sessionMatchesPaper(
  session: StudySessionLog,
  paper: Pick<PaperSummary, "key" | "questionIds">
) {
  return session.source?.paperKey === paper.key;
}

function scoreFor(session: StudySessionLog | null) {
  if (!session) {
    return null;
  }

  return session.answered ? (session.correct / session.answered) * 100 : 0;
}

function sessionTime(session: StudySessionLog) {
  const finishedAt = Date.parse(session.finishedAt);
  return Number.isNaN(finishedAt) ? Number.NEGATIVE_INFINITY : finishedAt;
}

export function latestCompletedPaperSession(
  paper: Pick<PaperSummary, "key" | "questionIds">,
  sessions: StudySessionLog[] = []
) {
  let latest: StudySessionLog | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;

  for (const session of sessions) {
    if (!isCompletedSession(session) || !sessionMatchesPaper(session, paper)) {
      continue;
    }

    const time = sessionTime(session);

    if (!latest || time > latestTime) {
      latest = session;
      latestTime = time;
    }
  }

  return latest;
}

// Up to 3 most recent completed-session scores for a paper, newest first.
export function recentPaperScores(
  paper: Pick<PaperSummary, "key" | "questionIds">,
  sessions: StudySessionLog[] = []
) {
  return sessions
    .filter(
      (session) => isCompletedSession(session) && sessionMatchesPaper(session, paper)
    )
    .sort((left, right) => sessionTime(right) - sessionTime(left))
    .slice(0, 3)
    .map((session) => scoreFor(session) ?? 0);
}

// Up to 3 most recent completed-session scores across a subject's papers.
function recentSubjectScores(
  papers: PaperSummary[],
  sessions: StudySessionLog[] = []
) {
  return sessions
    .filter(
      (session) =>
        isCompletedSession(session) &&
        papers.some((paper) => sessionMatchesPaper(session, paper))
    )
    .sort((left, right) => sessionTime(right) - sessionTime(left))
    .slice(0, 3)
    .map((session) => scoreFor(session) ?? 0);
}

// Groups the whole bank into study semester -> subject -> exam-term paper, with
// progress and latest-score rolled up at each level. Semesters are ordered by the
// curriculum (Vorklinik first), subjects alphabetically, papers newest first.
export function buildCurriculum(
  questions: Question[],
  progress: StoredProgress
): SemesterGroup[] {
  const sessions = progress.sessionLog || [];

  const rawPapers = new Map<
    string,
    { key: string; subject: string; examTerm: string; examTermSort: number; questionIds: string[] }
  >();

  for (const question of questions) {
    const key = paperKeyForQuestion(question);
    const existing = rawPapers.get(key);

    if (existing) {
      existing.questionIds.push(question.id);
      continue;
    }

    const term = examTermInfo(question);
    rawPapers.set(key, {
      key,
      subject: question.subject,
      examTerm: term.label,
      examTermSort: term.sort,
      questionIds: [question.id]
    });
  }

  const subjects = new Map<string, SubjectSummary>();

  for (const raw of Array.from(rawPapers.values())) {
    const semester = semesterForSubject(raw.subject);
    const answered = raw.questionIds.filter((questionId) =>
      Boolean(progress.answers?.[questionId])
    ).length;
    const total = raw.questionIds.length;

    const paper: PaperSummary = {
      key: raw.key,
      subject: raw.subject,
      semesterKey: semester.key,
      semesterLabel: semester.label,
      examTerm: raw.examTerm,
      examTermSort: raw.examTermSort,
      questionIds: raw.questionIds,
      total,
      answered,
      solved: total > 0 && answered === total,
      latestScore: scoreFor(latestCompletedPaperSession(raw, sessions)),
      recentScores: recentPaperScores(raw, sessions)
    };

    const subjectKey = `${semester.key}::${raw.subject.toLocaleLowerCase("de")}`;
    const subject = subjects.get(subjectKey);

    if (subject) {
      subject.papers.push(paper);
      subject.total += total;
      subject.answered += answered;
    } else {
      subjects.set(subjectKey, {
        key: subjectKey,
        subject: raw.subject,
        semesterKey: semester.key,
        semesterLabel: semester.label,
        total,
        answered,
        solved: false,
        latestScore: null,
        recentScores: [],
        papers: [paper]
      });
    }
  }

  const semesters = new Map<string, SemesterGroup>();

  for (const subject of Array.from(subjects.values())) {
    subject.solved = subject.total > 0 && subject.answered === subject.total;
    subject.papers.sort(
      (left, right) =>
        right.examTermSort - left.examTermSort ||
        left.examTerm.localeCompare(right.examTerm, "de")
    );
    subject.latestScore = subject.recentScores[0] ?? null;
    subject.recentScores = recentSubjectScores(subject.papers, sessions);

    const group = semesters.get(subject.semesterKey);

    if (group) {
      group.subjects.push(subject);
      group.total += subject.total;
    } else {
      const definition =
        CURRICULUM_SEMESTERS.find((entry) => entry.key === subject.semesterKey) ||
        UNASSIGNED_SEMESTER;

      semesters.set(subject.semesterKey, {
        key: definition.key,
        label: definition.label,
        sort: definition.sort,
        subjects: [subject],
        total: subject.total,
        subjectCount: 0
      });
    }
  }

  return Array.from(semesters.values())
    .map((group) => {
      group.subjects.sort((left, right) =>
        left.subject.localeCompare(right.subject, "de")
      );
      group.subjectCount = group.subjects.length;
      return group;
    })
    .sort((left, right) => left.sort - right.sort);
}
