#!/usr/bin/env node
// Read-only probe: logs in, hydrates a few questions from one subject, and prints
// the available fields so we can see where comments and statistics live.
// Writes nothing. Usage:
//   DOCSDOCS_USER="..." DOCSDOCS_PASSWORD="..." node scripts/inspect-docsdocs.mjs

const BASE_URL = process.env.DOCSDOCS_BASE_URL || "https://www.docsdocs.net";
const API_URL = `${BASE_URL}/api/v3`;
const USER = process.env.DOCSDOCS_USER;
const PASSWORD = process.env.DOCSDOCS_PASSWORD;

if (!USER || !PASSWORD) {
  console.error("Set DOCSDOCS_USER and DOCSDOCS_PASSWORD before inspecting.");
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

function sample(label, object) {
  console.log(`\n=== ${label} ===`);
  console.log("keys:", Object.keys(object || {}).join(", "));
  console.log(JSON.stringify(object, null, 2).slice(0, 1600));
}

await call("/system/login", {
  displayname: USER,
  password: PASSWORD,
  rememberme: false
});

const department = await call("/trainer/departmentinfo", {});
const counts = department.subjectnumquestions || {};
const subject = (department.subjects || []).find(
  (item) => Number(counts[item.uuid] || 0) > 0
);
console.log("Subject under inspection:", subject?.name);

const details = await call("/trainer/examsandtopics", { subjectuuid: subject.uuid });
console.log("examsandtopics keys:", Object.keys(details).join(", "));

const training = await call("/trainer/questionselection", {
  subjectuuid: subject.uuid,
  exams: [],
  topics: (details.topics || []).map((topic) => topic.uuid),
  includenulltopic: true,
  randomquestions: false,
  randomanswers: false,
  exammode: false
});

const meta = JSON.parse(
  (await call("/trainer/trainingmeta", { uuid: training.uuid || training }))
    .trainingmetaobject || "{}"
);
const entries = meta.questionentries || [];
console.log("training entry count:", entries.length);

const chunk = await call("/trainer/hydrate", {
  uuid: training.uuid || training,
  offset: 0,
  count: 3
});

console.log("\nhydrate chunk top-level keys:", Object.keys(chunk).join(", "));

const firstQuestion = Object.values(chunk.questions || {})[0];
sample("question record", firstQuestion);
sample("answer record", Object.values(chunk.answers || {})[0]);
sample("comment record", Object.values(chunk.comments || {})[0]);

for (const key of Object.keys(chunk)) {
  if (["questions", "answers", "comments", "topics", "exams"].includes(key)) {
    continue;
  }
  sample(`extra chunk.${key}`, Object.values(chunk[key] || {})[0] ?? chunk[key]);
}
