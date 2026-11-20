/**
 * WP-5.2 — Action Log Visualization: Timeline, audit trail, undo buttons
 * Shows all tool calls with input/output summaries, timestamps, tokens used
 * Displays reversible (A-level) actions with undo buttons
 * Implements WP-4.4 action log display contract
 */

import React, { useState, useMemo } from "react";
import type { ActionLogEntry } from "@/agent/approval-inbox";

export interface ActionLogUIProps {
  householdId: string;
  entries: ActionLogEntry[];
  onUndo?: (entryId: string) => Promise<void>;
  maxAge?: number; // Days
}

/**
 * Filter options
 */
interface FilterOptions {
  permissionLevel: "all" | "P" | "A";
  reversibleOnly: boolean;
  timeRange: "all" | "today" | "week" | "month";
}

/**
 * Action Log Timeline Component
 */
export function ActionLogUI({
  householdId,
  entries,
  onUndo,
  maxAge = 7,
}: ActionLogUIProps): React.JSX.Element {
  const [filters, setFilters] = useState<FilterOptions>({
    permissionLevel: "all",
    reversibleOnly: false,
    timeRange: "week",
  });

  const [undoInProgress, setUndoInProgress] = useState<string | null>(null);

  // Filter entries
  const filteredEntries = useMemo(() => {
    let result = entries;

    // Permission level
    if (filters.permissionLevel !== "all") {
      result = result.filter((e) => e.permissionLevel === filters.permissionLevel);
    }

    // Reversible only
    if (filters.reversibleOnly) {
      result = result.filter((e) => e.reversible && !e.undoneAt);
    }

    // Time range
    const now = new Date();
    if (filters.timeRange !== "all") {
      const cutoff = new Date();
      switch (filters.timeRange) {
        case "today":
          cutoff.setHours(0, 0, 0, 0);
          break;
        case "week":
          cutoff.setDate(cutoff.getDate() - 7);
          break;
        case "month":
          cutoff.setDate(cutoff.getDate() - 30);
          break;
      }
      result = result.filter((e) => new Date(e.timestamp) >= cutoff);
    }

    return result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [entries, filters]);

  const handleUndo = async (entryId: string) => {
    if (!onUndo) return;

    setUndoInProgress(entryId);
    try {
      await onUndo(entryId);
    } finally {
      setUndoInProgress(null);
    }
  };

  return (
    <div className="action-log-ui">
      {/* Filters */}
      <div className="action-log-filters">
        <div className="filter-group">
          <label>Permission Level:</label>
          <select
            value={filters.permissionLevel}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                permissionLevel: e.target.value as FilterOptions["permissionLevel"],
              }))
            }
          >
            <option value="all">All</option>
            <option value="P">Proposals (P)</option>
            <option value="A">Applied (A)</option>
          </select>
        </div>

        <div className="filter-group">
          <label>
            <input
              type="checkbox"
              checked={filters.reversibleOnly}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  reversibleOnly: e.target.checked,
                }))
              }
            />
            Reversible only
          </label>
        </div>

        <div className="filter-group">
          <label>Time Range:</label>
          <select
            value={filters.timeRange}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                timeRange: e.target.value as FilterOptions["timeRange"],
              }))
            }
          >
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="all">All time</option>
          </select>
        </div>
      </div>

      {/* Timeline */}
      <div className="action-log-timeline">
        {filteredEntries.length === 0 ? (
          <div className="action-log-empty">
            <p>No actions found</p>
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className={`action-log-entry action-log-entry-${entry.permissionLevel}`}
            >
              {/* Entry header */}
              <div className="entry-header">
                <div className="entry-title">
                  <span className={`level-badge level-${entry.permissionLevel}`}>
                    {entry.permissionLevel}-level
                  </span>
                  <strong>{entry.tool}</strong>
                  <span className="entry-agent">{entry.agentRole}</span>
                </div>

                <div className="entry-meta">
                  <span className="timestamp">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                  {entry.tokensUsed > 0 && (
                    <span className="tokens">
                      {entry.tokensUsed.toLocaleString()} tokens
                    </span>
                  )}
                  {entry.durationMs > 0 && (
                    <span className="duration">{entry.durationMs}ms</span>
                  )}
                </div>
              </div>

              {/* Input & Output summaries */}
              <div className="entry-summary">
                <div className="summary-item">
                  <span className="label">Input:</span>
                  <span className="value">{entry.inputsSummary}</span>
                </div>
                <div className="summary-item">
                  <span className="label">Result:</span>
                  <span className="value">{entry.resultSummary}</span>
                </div>
              </div>

              {/* Run ID & parent */}
              <div className="entry-context">
                <span className="run-id">Run: {entry.runId}</span>
                {entry.parentRunId && (
                  <span className="parent-run">Delegated from: {entry.parentRunId}</span>
                )}
              </div>

              {/* Undo button (A-level only) */}
              {entry.reversible && !entry.undoneAt && (
                <div className="entry-actions">
                  <button
                    className="btn-undo"
                    onClick={() => handleUndo(entry.id)}
                    disabled={undoInProgress === entry.id}
                  >
                    {undoInProgress === entry.id ? "Undoing..." : "↩️ Undo"}
                  </button>
                </div>
              )}

              {/* Undo status */}
              {entry.undoneAt && (
                <div className="entry-undone">
                  <span className="undo-marker">↩️ Undone</span>
                  <span className="undo-time">
                    {new Date(entry.undoneAt).toLocaleString()}
                  </span>
                  {entry.undoneByActionId && (
                    <span className="undo-by">by {entry.undoneByActionId}</span>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Summary stats */}
      <div className="action-log-stats">
        <div className="stat">
          <span className="stat-label">Total actions:</span>
          <span className="stat-value">{filteredEntries.length}</span>
        </div>

        <div className="stat">
          <span className="stat-label">P-level:</span>
          <span className="stat-value">
            {filteredEntries.filter((e) => e.permissionLevel === "P").length}
          </span>
        </div>

        <div className="stat">
          <span className="stat-label">A-level:</span>
          <span className="stat-value">
            {filteredEntries.filter((e) => e.permissionLevel === "A").length}
          </span>
        </div>

        <div className="stat">
          <span className="stat-label">Undoable:</span>
          <span className="stat-value">
            {filteredEntries.filter((e) => e.reversible && !e.undoneAt).length}
          </span>
        </div>

        <div className="stat">
          <span className="stat-label">Total tokens:</span>
          <span className="stat-value">
            {filteredEntries
              .reduce((sum, e) => sum + e.tokensUsed, 0)
              .toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * CSS styles for action log UI
 */
export const actionLogUIStyles = `
.action-log-ui {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  background: #f9f9f9;
  border-radius: 8px;
}

.action-log-filters {
  display: flex;
  gap: 16px;
  padding: 12px;
  background: white;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-group label {
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

.filter-group select,
.filter-group input[type="checkbox"] {
  padding: 6px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
}

.filter-group input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.action-log-timeline {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.action-log-empty {
  padding: 40px;
  text-align: center;
  color: #999;
  background: white;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
}

.action-log-entry {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: white;
  border-left: 4px solid #2196f3;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.action-log-entry-P {
  border-left-color: #ff9800;
}

.action-log-entry-A {
  border-left-color: #4caf50;
}

.entry-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.entry-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.level-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.level-P {
  background: #ffe0b2;
  color: #e65100;
}

.level-A {
  background: #c8e6c9;
  color: #2e7d32;
}

.entry-title strong {
  font-size: 14px;
  color: #333;
}

.entry-agent {
  font-size: 12px;
  color: #999;
  font-style: italic;
}

.entry-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #666;
  align-items: center;
}

.timestamp {
  font-weight: 500;
}

.tokens,
.duration {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: #f0f0f0;
  border-radius: 3px;
}

.entry-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #555;
}

.summary-item {
  display: flex;
  gap: 8px;
}

.summary-item .label {
  font-weight: 600;
  color: #333;
  min-width: 60px;
}

.summary-item .value {
  flex: 1;
  color: #666;
  word-break: break-word;
}

.entry-context {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: #999;
  padding-top: 4px;
  border-top: 1px solid #f0f0f0;
}

.run-id {
  font-family: monospace;
}

.parent-run {
  font-family: monospace;
  color: #1976d2;
}

.entry-actions {
  display: flex;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid #f0f0f0;
}

.btn-undo {
  padding: 6px 12px;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-undo:hover:not(:disabled) {
  background: #45a049;
}

.btn-undo:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.entry-undone {
  display: flex;
  gap: 8px;
  padding: 8px;
  background: #e8f5e9;
  border-radius: 4px;
  font-size: 12px;
  color: #2e7d32;
  align-items: center;
}

.undo-marker {
  font-weight: 600;
}

.undo-time {
  color: #558b2f;
}

.undo-by {
  color: #558b2f;
  font-family: monospace;
}

.action-log-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  padding: 12px;
  background: white;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
}

.stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-label {
  font-size: 13px;
  color: #666;
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  color: #333;
}
`;
