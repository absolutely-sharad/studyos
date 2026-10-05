import { pageRanges, type TopicSource } from "@/lib/resources";

export function SourcesList({ sources, empty }: { sources: TopicSource[]; empty: string }) {
  if (sources.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2 text-sm">
      {sources.slice(0, 6).map((s) => (
        <li key={s.documentId}>
          <a
            href={`/api/documents/${s.documentId}/file${s.pages[0] ? `#page=${s.pages[0]}` : ""}`}
            target="_blank"
            rel="noopener"
            className="font-bold underline-offset-4 hover:underline"
          >
            {s.filename}
          </a>
          <span className="text-muted">
            {" "}
            ({s.categoryLabel}){s.pages.length > 0 && `, page${s.pages.length === 1 ? "" : "s"} ${pageRanges(s.pages.slice(0, 12))}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
