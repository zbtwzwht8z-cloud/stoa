import rawQuestions from "../../data/questions.json";
import type { Question, QuestionIndex } from "./types";

function assertQuestion(question: Question, index: number) {
  const prefix = `Question ${index + 1}`;

  if (!question.id) {
    throw new Error(`${prefix} is missing id`);
  }

  if (!question.stem) {
    throw new Error(`${prefix} is missing stem`);
  }

  if (question.kind === "freeText") {
    if (!question.modelAnswer) {
      throw new Error(`${prefix} is missing modelAnswer`);
    }

    return;
  }

  if (!Array.isArray(question.choices) || question.choices.length < 2) {
    throw new Error(`${prefix} must have at least two choices`);
  }

  if (!question.choices.some((choice) => choice.id === question.answer)) {
    throw new Error(`${prefix} answer must match a choice id`);
  }
}

export const questions = (rawQuestions as Question[]).map((question, index) => {
  assertQuestion(question, index);

  return {
    ...question,
    subject: question.subject || "General",
    topic: question.topic || "Unsorted",
    tags: question.tags || []
  };
});

// Lightweight index: enough for Papers/Dashboard (semester grouping, paper keys,
// question counts) without the 18 MB of stems/choices/explanations/notes.
export const questionIndex: QuestionIndex[] = questions.map((question) => ({
  id: question.id,
  subject: question.subject,
  topic: question.topic,
  source: question.source,
  kind: question.kind
}));
