/**
 * Session Storage
 *
 * Manages persistent storage of session metadata for session history and rewind features.
 * Sessions are stored in ~/.claude/acp-sessions.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CLAUDE_CONFIG_DIR } from "./acp-agent.js";

// Lazy-initialized to avoid TDZ error from circular dependency
const getSessionsFile = () => path.join(CLAUDE_CONFIG_DIR, "acp-sessions.json");
const MAX_SESSIONS = 1000; // Limit to prevent unbounded growth

/**
 * Session metadata stored for history
 */
export interface SessionMetadata {
  sessionId: string;
  title: string;
  cwd: string;
  createdAt: number; // Unix timestamp in milliseconds
  updatedAt: number; // Unix timestamp in milliseconds
}

/**
 * Structure of the sessions file
 */
interface SessionsFile {
  sessions: SessionMetadata[];
}

/**
 * Load sessions from disk
 */
function loadSessions(): SessionMetadata[] {
  try {
    const sessionsFile = getSessionsFile();
    if (!fs.existsSync(sessionsFile)) {
      return [];
    }

    const content = fs.readFileSync(sessionsFile, "utf-8");
    const data: SessionsFile = JSON.parse(content);
    return data.sessions || [];
  } catch (error) {
    console.error("Failed to load sessions:", error);
    return [];
  }
}

/**
 * Save sessions to disk
 */
function saveSessions(sessions: SessionMetadata[]): void {
  try {
    // Ensure directory exists
    if (!fs.existsSync(CLAUDE_CONFIG_DIR)) {
      fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true });
    }

    const data: SessionsFile = { sessions };
    const sessionsFile = getSessionsFile();
    fs.writeFileSync(sessionsFile, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to save sessions:", error);
  }
}

/**
 * Add or update a session
 */
export function upsertSession(session: Omit<SessionMetadata, "createdAt" | "updatedAt">): void {
  const sessions = loadSessions();
  const existingIndex = sessions.findIndex((s) => s.sessionId === session.sessionId);

  const now = Date.now();

  if (existingIndex >= 0) {
    // Update existing session
    sessions[existingIndex] = {
      ...sessions[existingIndex],
      ...session,
      updatedAt: now,
    };
  } else {
    // Add new session
    sessions.push({
      ...session,
      createdAt: now,
      updatedAt: now,
    });

    // Limit total sessions
    if (sessions.length > MAX_SESSIONS) {
      // Remove oldest sessions (by updatedAt)
      sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      sessions.splice(MAX_SESSIONS);
    }
  }

  saveSessions(sessions);
}

/**
 * Get all sessions, optionally filtered by cwd and paginated
 */
export function listSessions(options?: {
  cwd?: string | null;
  cursor?: string | null;
  limit?: number;
}): {
  sessions: SessionMetadata[];
  nextCursor?: string;
} {
  const limit = options?.limit || 20;
  let sessions = loadSessions();

  // Filter by cwd if provided
  if (options?.cwd) {
    sessions = sessions.filter((s) => s.cwd === options.cwd);
  }

  // Sort by updatedAt descending (most recent first)
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);

  // Handle pagination
  let startIndex = 0;
  if (options?.cursor) {
    // Cursor is the index + timestamp to ensure uniqueness
    const [indexStr, timestampStr] = options.cursor.split("-");
    const cursorIndex = parseInt(indexStr, 10);
    const cursorTimestamp = parseInt(timestampStr, 10);

    // Find the session matching the cursor
    const cursorSessionIndex = sessions.findIndex(
      (s, i) => i === cursorIndex && s.updatedAt === cursorTimestamp,
    );

    if (cursorSessionIndex >= 0) {
      startIndex = cursorSessionIndex + 1;
    }
  }

  // Get page of sessions
  const pageSessions = sessions.slice(startIndex, startIndex + limit);

  // Generate next cursor if there are more sessions
  let nextCursor: string | undefined;
  if (startIndex + limit < sessions.length) {
    const nextIndex = startIndex + limit;
    const nextSession = sessions[nextIndex];
    nextCursor = `${nextIndex}-${nextSession.updatedAt}`;
  }

  return {
    sessions: pageSessions,
    nextCursor,
  };
}

/**
 * Get a specific session by ID
 */
export function getSession(sessionId: string): SessionMetadata | null {
  const sessions = loadSessions();
  return sessions.find((s) => s.sessionId === sessionId) || null;
}

/**
 * Delete a session
 */
export function deleteSession(sessionId: string): void {
  const sessions = loadSessions();
  const filtered = sessions.filter((s) => s.sessionId !== sessionId);
  saveSessions(filtered);
}
