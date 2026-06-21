// Lightweight UI translation layer. Core chrome only (nav, titles, buttons,
// dashboard, papers, login). Question content stays in its original German.

export type Lang = "en" | "de";

export const LANGS: Lang[] = ["en", "de"];

export const LANG_STORAGE_KEY = "stoa-lang";

type Dict = Record<string, string>;

const en: Dict = {
  "nav.dashboard": "Dashboard",
  "nav.subjects": "Papers",
  "nav.trainer": "Trainer",
  "nav.sessions": "Sessions",
  "nav.search": "Search",
  "nav.mistakes": "Mistakes",
  "nav.bookmarks": "Bookmarks",
  "nav.admin": "Admin",

  "common.logout": "Log out",
  "common.signin": "Sign in",
  "common.clear": "Clear",
  "common.cancel": "Cancel",

  "dashboard.start": "Start a session",
  "dashboard.custom": "Custom session",
  "dashboard.review": "Review mistakes",
  "dashboard.papers": "Papers",
  "dashboard.recent": "Recent sessions",
  "dashboard.week": "This week",

  "stat.answered": "Answered",
  "stat.accuracy": "Accuracy",
  "stat.mistakes": "Mistakes",
  "stat.coverage": "Coverage",

  "papers.intro":
    "Pick a semester, open a subject, then start one paper — or tick several papers and run them together.",
  "papers.study": "Study",
  "papers.exam": "Exam",
  "papers.semester": "Semester",
  "papers.notStarted": "Not started",
  "papers.solved": "Solved",
  "papers.latestScore": "Latest score",
  "papers.startPapers": "Start",
  "papers.selected": "selected",

  "unit.question": "question",
  "unit.questions": "questions",
  "unit.paper": "paper",
  "unit.papers": "papers",
  "unit.subject": "subject",
  "unit.subjects": "subjects",

  "login.subtitle": "Private exam trainer. Sign in to continue.",
  "login.username": "Username",
  "login.password": "Password"
};

const de: Dict = {
  "nav.dashboard": "Übersicht",
  "nav.subjects": "Klausuren",
  "nav.trainer": "Trainer",
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

const dicts: Record<Lang, Dict> = { en, de };

export type Translate = (key: string) => string;

export function createTranslator(lang: Lang): Translate {
  return (key) => dicts[lang][key] ?? dicts.en[key] ?? key;
}
