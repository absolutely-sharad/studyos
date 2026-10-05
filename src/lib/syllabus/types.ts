export interface DraftTopic {
  name: string;
  chapter: string | null;
  aliases: string[];
  difficulty: number;
  importance: number;
  estimatedMinutes: number;
  /** Names of prerequisite topics in the same draft. */
  prerequisites: string[];
  confidence: number;
}

export interface DraftSubject {
  name: string;
  topics: DraftTopic[];
}

export interface SyllabusDraft {
  subjects: DraftSubject[];
  source: "ai" | "parser";
}
