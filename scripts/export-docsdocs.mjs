#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { htmlToText } from "html-to-text";

const BASE_URL = process.env.DOCSDOCS_BASE_URL || "https://www.docsdocs.net";
const API_URL = `${BASE_URL}/api/v3`;
const RES_USER_URL = `${BASE_URL}/resuser`;
const OUTPUT_PATH = path.resolve(process.argv[2] || "data/questions.json");
const USER = process.env.DOCSDOCS_USER;
const PASSWORD = process.env.DOCSDOCS_PASSWORD;
const BATCH_SIZE = Number.parseInt(process.env.DOCSDOCS_BATCH_SIZE || "100", 10);
const REQUEST_DELAY_MS = Number.parseInt(
  process.env.DOCSDOCS_DELAY_MS || "120",
  10
);

if (!USER || !PASSWORD) {
  console.error("Set DOCSDOCS_USER and DOCSDOCS_PASSWORD before exporting.");
  process.exit(1);
}

class CookieJar {
  cookies = new Map();

  store(headers) {
    const values =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : [headers.get("set-cookie")].filter(Boolean);

    for (const value of values) {
      const [cookie] = value.split(";");
      const separator = cookie.indexOf("=");

      if (separator === -1) {
        continue;
      }

      this.cookies.set(cookie.slice(0, separator), cookie.slice(separator + 1));
    }
  }

  header() {
    return Array.from(this.cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }
}

const jar = new CookieJar();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function call(endpoint, body) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(jar.header() ? { Cookie: jar.header() } : {})
    },
    body: JSON.stringify(body)
  });

  jar.store(response.headers);

  const text = await response.text();
  let json;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${endpoint}: expected JSON, got ${text.slice(0, 180)}`);
  }

  if (!response.ok) {
    throw new Error(`${endpoint}: HTTP ${response.status}`);
  }

  if (json.code > 0) {
    throw new Error(`${endpoint}: ${json.msg || `code ${json.code}`}`);
  }

  return json.data;
}

function stripHtml(html) {
  return htmlToText(html || "", {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: false } },
      { selector: "img", format: "skip" }
    ]
  })
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function answerLabel(index) {
  return String.fromCharCode(65 + index);
}

function imageUrl(questionUuid, imageFile) {
  if (!imageFile) {
    return undefined;
  }

  const first = imageFile.charAt(0);
  const firstTwo = imageFile.slice(0, 2);

  return `${RES_USER_URL}/img/${questionUuid}/${first}/${firstTwo}/${imageFile}`;
}

function toQuestion(record, chunk, subject) {
  const answerRecords = Object.values(chunk.answers || {}).filter(
    (answer) => answer.fk_Question_question === record.uuid && answer.active !== 0
  );
  const notes = Object.values(chunk.comments || {})
    .filter(
      (comment) =>
        comment.fk_Question_question === record.uuid && comment.active !== 0
    )
    .map((comment) => stripHtml(comment.text))
    .filter(Boolean);
  const choices = answerRecords.map((answer, index) => ({
    id: answerLabel(index),
    text: stripHtml(answer.text)
  }));
  const correctIndex = answerRecords.findIndex((answer) => Number(answer.correct) === 1);
  const topicRecord = record.fk_Topic_topic
    ? chunk.topics?.[record.fk_Topic_topic]
    : undefined;
  const examRecord = record.fk_Exam_exam ? chunk.exams?.[record.fk_Exam_exam] : undefined;
  const topic = topicRecord?.name || examRecord?.name || "Unsorted";
  const tags = [topicRecord?.name, examRecord?.name].filter(
    (value, index, values) => value && values.indexOf(value) === index
  );

  if (!record.uuid || !record.text) {
    return null;
  }

  const base = {
    id: record.uuid,
    subject: subject.name,
    topic,
    source: examRecord?.name ? `${subject.name} / ${examRecord.name}` : subject.name,
    stem: stripHtml(record.text),
    imageUrl: imageUrl(record.uuid, record.imageurl),
    explanation: record.comment ? stripHtml(record.comment) : undefined,
    notes,
    tags
  };

  // Free-text/essay question: the site stores these as a single answer record
  // (marked correct) holding the written model answer, not a multiple-choice
  // option. No A-E choices exist, so render them as stem + reveal-answer.
  if (answerRecords.length === 1 && Number(answerRecords[0].correct) === 1) {
    return {
      ...base,
      kind: "freeText",
      choices: [],
      answer: "",
      modelAnswer: stripHtml(answerRecords[0].text)
    };
  }

  if (choices.length < 2 || correctIndex === -1) {
    return null;
  }

  const answeredCount = Number(chunk.questionstats?.[record.uuid] || 0);
  const choiceStats = answerRecords.map((answer, index) => ({
    id: answerLabel(index),
    count: Number(chunk.answerstats?.[answer.uuid] || 0)
  }));
  const correctCount = Number(
    chunk.answerstats?.[answerRecords[correctIndex].uuid] || 0
  );
  const stats =
    answeredCount > 0
      ? { answered: answeredCount, correct: correctCount, choices: choiceStats }
      : undefined;

  return {
    ...base,
    kind: "mcq",
    choices,
    answer: choices[correctIndex].id,
    stats
  };
}

async function createSubjectTraining(subject, selection) {
  return call("/trainer/questionselection", {
    subjectuuid: subject.uuid,
    exams: selection.exams || [],
    topics: selection.topics || [],
    includenulltopic: selection.includenulltopic ?? true,
    randomquestions: false,
    randomanswers: false,
    exammode: false
  });
}

async function getTrainingEntries(trainingUuid) {
  const data = await call("/trainer/trainingmeta", { uuid: trainingUuid });
  const meta = JSON.parse(data.trainingmetaobject || "{}");

  return meta.questionentries || [];
}

async function hydrate(trainingUuid, offset, count) {
  return call("/trainer/hydrate", {
    uuid: trainingUuid,
    offset,
    count
  });
}

async function subjectSelections(subject, expectedCount) {
  const details = await call("/trainer/examsandtopics", { subjectuuid: subject.uuid });
  const topicIds = (details.topics || []).map((topic) => topic.uuid);
  const subjectTopiclessCount = Number(
    details.subjecttopiclessnumquestions?.[subject.uuid] || 0
  );
  const includenulltopic = topicIds.length === 0 || subjectTopiclessCount > 0;

  if (expectedCount <= 500) {
    await sleep(REQUEST_DELAY_MS);

    return [
      {
        label: subject.name,
        expectedCount,
        exams: [],
        topics: topicIds,
        includenulltopic
      }
    ];
  }

  // Primary split: by exam (each <=500). This is the original, known-good path
  // and captures every exam-attached question.
  const examSelections = (details.exams || [])
    .map((exam) => ({
      label: `${subject.name} / ${exam.name}`,
      expectedCount: Number(details.examnumquestions?.[exam.uuid] || 0),
      exams: [exam.uuid],
      topics: topicIds,
      includenulltopic
    }))
    .filter((selection) => selection.expectedCount > 0);

  // Exam selections miss questions filed under a topic with no exam. Add a
  // selection per topic plus a topicless sweep (only when small enough to stay
  // under the cap). Results are de-duped by the caller, so these strictly ADD to
  // the exam selections and can never reduce coverage below the original.
  const topicSelections = topicIds.map((topicUuid, index) => ({
    label: `${subject.name} / topic ${index + 1}/${topicIds.length}`,
    exams: [],
    topics: [topicUuid],
    includenulltopic: false
  }));

  const topiclessSelections =
    subjectTopiclessCount > 0 && subjectTopiclessCount <= 500
      ? [
          {
            label: `${subject.name} / no topic`,
            exams: [],
            topics: [],
            includenulltopic: true
          }
        ]
      : [];

  const selections = [
    ...examSelections,
    ...topicSelections,
    ...topiclessSelections
  ];

  if (!selections.length) {
    throw new Error(`${subject.name}: no exam or topic selections available`);
  }

  await sleep(REQUEST_DELAY_MS);
  return selections;
}

async function exportSelection(subject, selection) {
  console.log(`  Selection: ${selection.label} (${selection.expectedCount ?? "?"})`);

  const trainingUuid = await createSubjectTraining(subject, selection);
  await sleep(REQUEST_DELAY_MS);

  const entries = await getTrainingEntries(trainingUuid);
  const total = entries.length;
  const questions = [];

  for (let offset = 0; offset < total; offset += BATCH_SIZE) {
    const count = Math.min(BATCH_SIZE, total - offset);
    const chunk = await hydrate(trainingUuid, offset, count);
    const normalized = Object.values(chunk.questions || {})
      .map((record) => toQuestion(record, chunk, subject))
      .filter(Boolean);

    questions.push(...normalized);
    console.log(`  ${Math.min(offset + count, total)}/${total}`);
    await sleep(REQUEST_DELAY_MS);
  }

  return questions;
}

async function exportSubject(subject, expectedCount) {
  console.log(`Subject: ${subject.name} (${expectedCount})`);

  const selections = await subjectSelections(subject, expectedCount);
  const collected = new Map();

  for (const selection of selections) {
    try {
      for (const question of await exportSelection(subject, selection)) {
        collected.set(question.id, question);
      }
    } catch (error) {
      console.warn(`  Selection failed (${selection.label}): ${error.message}`);
    }
  }

  if (collected.size < expectedCount) {
    console.warn(
      `  ${subject.name}: collected ${collected.size}, site lists ${expectedCount}`
    );
  }

  return [...collected.values()];
}

console.log("Logging in");
await call("/system/login", {
  displayname: USER,
  password: PASSWORD,
  rememberme: false
});

const department = await call("/trainer/departmentinfo", {});
const subjectCounts = department.subjectnumquestions || {};
const subjects = (department.subjects || []).filter(
  (subject) => Number(subjectCounts[subject.uuid] || 0) > 0
);
const allQuestions = new Map();

console.log(
  `Exporting ${subjects.length} subjects / ${Object.values(subjectCounts).reduce(
    (sum, count) => sum + Number(count || 0),
    0
  )} listed questions`
);

for (const subject of subjects) {
  const exported = await exportSubject(subject, Number(subjectCounts[subject.uuid] || 0));

  for (const question of exported) {
    allQuestions.set(question.id, question);
  }
}

const normalized = Array.from(allQuestions.values()).sort((left, right) =>
  [left.subject, left.topic, left.id]
    .join("\u0000")
    .localeCompare([right.subject, right.topic, right.id].join("\u0000"))
);

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

console.log(`Wrote ${normalized.length} unique questions to ${OUTPUT_PATH}`);
