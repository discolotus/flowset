import type { LastMp3Export } from "../lib/workspaceState";

interface LocalDataSummaryProps {
  analysisCachePaths: string[];
  lastMp3Export: LastMp3Export | null;
  workspaceStatePath: string | null;
}

function PathValue({ children }: { children: string }) {
  return <code className="local-data-path" title={children}>{children}</code>;
}

export function LocalDataSummary({
  analysisCachePaths,
  lastMp3Export,
  workspaceStatePath,
}: LocalDataSummaryProps) {
  return (
    <details className="sidebar-utility-section local-data-summary">
      <summary>
        <span>
          <span className="eyebrow">Local data</span>
          <strong>Cache &amp; history</strong>
        </span>
        <small>Paths and recent exports</small>
      </summary>

      <div className="local-data-content">
        <div className="local-data-item">
          <strong>Analysis cache</strong>
          {analysisCachePaths.length > 0 ? (
            analysisCachePaths.map((path) => <PathValue key={path}>{path}</PathValue>)
          ) : (
            <p>After analysis: each imported playlist’s <code>.sequence/analysis-cache.json</code>.</p>
          )}
        </div>

        <div className="local-data-item">
          <strong>Last MP3 export</strong>
          {lastMp3Export ? (
            <>
              <PathValue>{lastMp3Export.directory}</PathValue>
              <small>{new Date(lastMp3Export.exportedAt).toLocaleString()}</small>
            </>
          ) : (
            <p>No MP3 export has been recorded yet.</p>
          )}
        </div>

        <div className="local-data-item">
          <strong>Recipe &amp; folder history</strong>
          {workspaceStatePath ? (
            <PathValue>{workspaceStatePath}</PathValue>
          ) : (
            <p>Stored in this browser profile. The Mac app uses a readable JSON file in its app-data folder.</p>
          )}
        </div>
      </div>
    </details>
  );
}
