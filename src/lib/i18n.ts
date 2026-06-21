// German-only UI strings. The app ships in German exclusively; question
// content is already German. Plain lookup, no translator factory.

const strings = {
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
} as const;

export type TranslationKey = keyof typeof strings;
export type Translate = (key: string) => string;

export function t(key: string): string {
  return (strings as Record<string, string>)[key] ?? key;
}
