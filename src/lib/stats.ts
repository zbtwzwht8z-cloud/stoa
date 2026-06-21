import type { LeaderboardEntry, Question, StoredProgress } from "@/lib/types";

export function percent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value);
}

export function progressStats(progress: StoredProgress, questions: Question[]) {
  const questionIds = new Set(questions.map((question) => question.id));
  const answers = Object.entries(progress.answers || {}).filter(([id]) =>
    questionIds.has(id)
  );
  // freeText reveals have correct === undefined and are excluded from
  // accuracy/missed (they're not graded), but still count as answered.
  const graded = answers.filter(([, answer]) => answer.correct !== undefined);
  const correct = graded.filter(([, answer]) => answer.correct).length;
  const missed = graded.length - correct;

  return {
    answered: answers.length,
    correct,
    missed,
    accuracy: graded.length ? percent((correct / graded.length) * 100) : 0
  };
}

export function subjectStats(progress: StoredProgress, questions: Question[]) {
  const bySubject = new Map<
    string,
    {
      subject: string;
      total: number;
      answered: number;
      correct: number;
      missed: number;
      graded: number;
    }
  >();

  for (const question of questions) {
    const current =
      bySubject.get(question.subject) ||
      {
        subject: question.subject,
        total: 0,
        answered: 0,
        correct: 0,
        missed: 0,
        graded: 0
      };
    const answer = progress.answers?.[question.id];

    current.total += 1;

    if (answer) {
      current.answered += 1;

      if (answer.correct !== undefined) {
        current.graded += 1;
        current.correct += answer.correct ? 1 : 0;
        current.missed += answer.correct ? 0 : 1;
      }
    }

    bySubject.set(question.subject, current);
  }

  return Array.from(bySubject.values())
    .map((item) => ({
      ...item,
      accuracy: item.graded ? percent((item.correct / item.graded) * 100) : 0,
      completion: percent((item.answered / item.total) * 100)
    }))
    .sort((left, right) => left.subject.localeCompare(right.subject));
}

export function leaderboardFromProgress(
  users: { id: string; name: string }[],
  progressByUser: Record<string, StoredProgress>
): LeaderboardEntry[] {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  return users
    .map((user) => {
      const answers = Object.values(progressByUser[user.id]?.answers || {});
      const graded = answers.filter((answer) => answer.correct !== undefined);
      const correct = graded.filter((answer) => answer.correct).length;
      const weeklyAnswered = answers.filter(
        (answer) => new Date(answer.answeredAt).getTime() >= weekAgo
      ).length;

      return {
        userId: user.id,
        name: user.name,
        answered: answers.length,
        correct,
        accuracy: graded.length ? percent((correct / graded.length) * 100) : 0,
        weeklyAnswered
      };
    })
    .sort((left, right) => right.weeklyAnswered - left.weeklyAnswered);
}
