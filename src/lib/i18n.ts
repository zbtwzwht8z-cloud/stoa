// German-only UI text. The app ships in German exclusively; the translator
// keeps a t() API so call sites stay unchanged, but there is only one dict.
// Question content is already German.

export type Lang = "de";

export const LANGS: Lang[] = ["de"];

export const LANG_STORAGE_KEY = "stoa-lang";

type Dict = Record<string, string>;

const de: Dict = {
  "nav.dashboard": "Übersicht",
  "nav.subjects": "Klausuren",
  "nav.trainer": "Sitzungen",
  "nav.sessions": "Sitzungen",
  "nav.search": "Suche",
  "nav.mistakes": "Fehler",
  "nav.bookmarks": "Lesezeichen",
  "nav.admin": "Admin",

  "common.logout": "Abmelden",
  "common.signin": "Anmelden",
  "common.clear": "Leeren",
  "common.cancel": "Abbrechen",

  "dashboard.start": "Sitzung starten",
  "dashboard.custom": "Eigene Sitzung",
  "dashboard.review": "Fehler wiederholen",
  "dashboard.papers": "Klausuren",
  "dashboard.recent": "Letzte Sitzungen",
  "dashboard.week": "Diese Woche",

  "stat.answered": "Beantwortet",
  "stat.accuracy": "Trefferquote",
  "stat.mistakes": "Fehler",
  "stat.coverage": "Abdeckung",

  "papers.intro":
    "Wähle ein Semester, öffne ein Fach und starte eine Klausur — oder hake mehrere Klausuren an und übe sie zusammen.",
  "papers.study": "Lernen",
  "papers.exam": "Prüfung",
  "papers.semester": "Semester",
  "papers.notStarted": "Nicht begonnen",
  "papers.solved": "Gelöst",
  "papers.latestScore": "Letztes Ergebnis",
  "papers.startPapers": "Starten",
  "papers.selected": "ausgewählt",
  "papers.custom": "Eigene Sitzung",

  "unit.question": "Frage",
  "unit.questions": "Fragen",
  "unit.paper": "Klausur",
  "unit.papers": "Klausuren",
  "unit.subject": "Fach",
  "unit.subjects": "Fächer",

  "login.subtitle": "Privater Klausurtrainer. Zum Fortfahren anmelden.",
  "login.username": "Benutzername",
  "login.password": "Passwort"
};

export type Translate = (key: string) => string;

export function createTranslator(_lang?: Lang): Translate {
  return (key) => de[key] ?? key;
}
