#!/usr/bin/env node
// Read-only diagnostic: for one subject, compares the site's listed count
// against (a) training-entry count for the full-subject selection and
// (b) how many entries actually survive toQuestion's validity filter.
// Usage:
//   DOCSDOCS_USER="..." DOCSDOCS_PASSWORD="..." node scripts/diagnose-subject.mjs "Pharmakologie 1"

const BASE_URL = process.env.DOCSDOCS_BASE_URL || "https://www.docsdocs.net";
const API_URL = `${BASE_URL}/api/v3`;
const USER = process.env.DOCSDOCS_USER;
const PASSWORD = process.env.DOCSDOCS_PASSWORD;
const TARGET_NAME = process.argv[2];

if (!USER || !PASSWORD || !TARGET_NAME) {
  console.error(
    'Usage: DOCSDOCS_USER=... DOCSDOCS_PASSWORD=... node scripts/diagnose-subject.mjs "Subject Name"'
  );
  process.exit(1);
}

const jar = new Map();

function cookieHeader() {
  return Array.from(jar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

async function call(endpoint, body) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(cookieHeader() ? { Cookie: cookieHeader() } : {})
    },
    body: JSON.stringify(body)
  });

  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);

  for (const value of setCookies) {
    const [cookie] = value.split(";");
    const separator = cookie.indexOf("=");
    if (separator !== -1) {
      jar.set(cookie.slice(0, separator), cookie.slice(separator + 1));
    }
  }

  const json = JSON.parse(await response.text());
  if (json.code > 0) {
    throw new Error(`${endpoint}: ${json.msg || `code ${json.code}`}`);
  }
  return json.data;
}

await call("/system/login", { displayname: USER, password: PASSWORD, rememberme: false });

const department = await call("/trainer/departmentinfo", {});
const subject = (department.subjects || []).find((item) => item.name === TARGET_NAME);

if (!subject) {
  console.error(`Subject not found: ${TARGET_NAME}`);
  console.error("Available:", (department.subjects || []).map((s) => s.name).join(", "));
  process.exit(1);
}

const listedCount = Number(department.subjectnumquestions?.[subject.uuid] || 0);
console.log(`Subject: ${subject.name} (${subject.uuid})`);
console.log(`Listed by departmentinfo: ${listedCount}`);

const details = await call("/trainer/examsandtopics", { subjectuuid: subject.uuid });
console.log("\nexamsandtopics fields:");
console.log("  exams:", (details.exams || []).length);
console.log("  topics:", (details.topics || []).length);
console.log("  examnumquestions sum:", Object.values(details.examnumquestions || {}).reduce((a, b) => a + Number(b), 0));
console.log("  topicnumquestions sum:", Object.values(details.topicnumquestions || {}).reduce((a, b) => a + Number(b), 0));
console.log("  topicexamnumquestions sum:", Object.values(details.topicexamnumquestions || {}).reduce((a, b) => a + Number(b), 0));
console.log("  subjecttopiclessnumquestions:", details.subjecttopiclessnumquestions);
console.log("  examtopiclessnumquestions:", details.examtopiclessnumquestions);
console.log("  stats:", JSON.stringify(details.stats).slice(0, 300));
console.log("  subjectstats:", JSON.stringify(details.subjectstats).slice(0, 300));

const topicIds = (details.topics || []).map((topic) => topic.uuid);

// Full-subject selection: same as the exporter's <=500 path.
const training = await call("/trainer/questionselection", {
  subjectuuid: subject.uuid,
  exams: [],
  topics: topicIds,
  includenulltopic: true,
  randomquestions: false,
  randomanswers: false,
  exammode: false
});
const trainingUuid = training.uuid || training;
const meta = JSON.parse(
  (await call("/trainer/trainingmeta", { uuid: trainingUuid })).trainingmetaobject || "{}"
);
const entries = meta.questionentries || [];
console.log(`\nFull-subject selection (exams=[], topics=ALL, includenulltopic=true):`);
console.log(`  training entries: ${entries.length}`);

// Hydrate everything and see how many pass the same validity filter the
// exporter uses (>=2 active answers, exactly one marked correct).
let valid = 0;
let invalidNoAnswers = 0;
let invalidNoCorrect = 0;
let inactiveQuestions = 0;
const BATCH = 100;

for (let offset = 0; offset < entries.length; offset += BATCH) {
  const count = Math.min(BATCH, entries.length - offset);
  const chunk = await call("/trainer/hydrate", { uuid: trainingUuid, offset, count });
  const questions = Object.values(chunk.questions || {});

  for (const record of questions) {
    if (record.active === 0) {
      inactiveQuestions += 1;
      continue;
    }

    const answers = Object.values(chunk.answers || {}).filter(
      (answer) => answer.fk_Question_question === record.uuid && answer.active !== 0
    );

    if (answers.length < 2) {
      invalidNoAnswers += 1;
      continue;
    }

    const hasCorrect = answers.some((answer) => Number(answer.correct) === 1);

    if (!hasCorrect) {
      invalidNoCorrect += 1;
      continue;
    }

    valid += 1;
  }

  await new Promise((resolve) => setTimeout(resolve, 120));
}

console.log(`\nHydrated and validated all ${entries.length} entries:`);
console.log(`  valid (importable): ${valid}`);
console.log(`  inactive question record: ${inactiveQuestions}`);
console.log(`  fewer than 2 active answers: ${invalidNoAnswers}`);
console.log(`  no answer marked correct: ${invalidNoCorrect}`);
console.log(
  `\nGap vs listed: listed ${listedCount} - valid ${valid} = ${listedCount - valid}`
);
console.log(
  `Gap vs training entries: entries ${entries.length} - listed ${listedCount} = ${entries.length - listedCount}`
);

// --- extra: dump a sample of "fewer than 2 active answers" records ---
console.log("\n=== Sample malformed records ===");
let shown = 0;
for (let offset = 0; offset < entries.length && shown < 3; offset += BATCH) {
  const count = Math.min(BATCH, entries.length - offset);
  const chunk = await call("/trainer/hydrate", { uuid: trainingUuid, offset, count });
  const questions = Object.values(chunk.questions || {});

  for (const record of questions) {
    if (shown >= 3) break;
    const allAnswers = Object.values(chunk.answers || {}).filter(
      (answer) => answer.fk_Question_question === record.uuid
    );
    const activeAnswers = allAnswers.filter((answer) => answer.active !== 0);

    if (activeAnswers.length < 2) {
      shown += 1;
      console.log(`\n--- record ${shown} ---`);
      console.log("question:", JSON.stringify(record, null, 2));
      console.log("ALL answers (incl inactive):", JSON.stringify(allAnswers, null, 2));
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
}
