import Database from 'better-sqlite3';
import * as path from 'path';

const DB_PATH = path.join(__dirname, 'inspector.db');

// Initialize database connection
export const db = new Database(DB_PATH);

// Enable foreign keys and WAL mode for better performance
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// Initialize database schema
export function initializeDatabase(): void {
    const createRequestsTable = `
        CREATE TABLE IF NOT EXISTS requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            method TEXT NOT NULL,
            path TEXT NOT NULL,
            status_code INTEGER,
            duration_ms INTEGER,
            request_headers TEXT,
            request_body TEXT,
            response_headers TEXT,
            response_body TEXT,
            error TEXT,
            timestamp INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    const createSessionsTable = `
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            name TEXT,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            ended_at DATETIME,
            request_count INTEGER DEFAULT 0
        )
    `;

    const createIndexes = `
        CREATE INDEX IF NOT EXISTS idx_requests_session_id ON requests(session_id);
        CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
        CREATE INDEX IF NOT EXISTS idx_requests_method ON requests(method);
        CREATE INDEX IF NOT EXISTS idx_requests_status_code ON requests(status_code);
    `;

    try {
        db.exec(createRequestsTable);
        db.exec(createSessionsTable);
        db.exec(createIndexes);
        console.log('[DB] Database initialized successfully');
    } catch (error) {
        console.error('[DB] Error initializing database:', error);
        throw error;
    }
}

// Graceful shutdown
export function closeDatabase(): void {
    try {
        db.close();
        console.log('[DB] Database connection closed');
    } catch (error) {
        console.error('[DB] Error closing database:', error);
    }
}

// Initialize on module load
initializeDatabase();

// Handle process termination
process.on('SIGINT', () => {
    closeDatabase();
    process.exit(0);
});

process.on('SIGTERM', () => {
    closeDatabase();
    process.exit(0);
});
