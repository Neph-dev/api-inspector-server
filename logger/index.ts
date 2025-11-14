import { db } from '../db/init';

const MAX_BODY_SIZE = 1024 * 1024; // 1MB in bytes

interface LogRequestData {
    sessionId: string;
    method: string;
    path: string;
    statusCode?: number;
    durationMs?: number;
    requestHeaders?: Record<string, string | string[]>;
    requestBody?: any;
    responseHeaders?: Record<string, string | string[]>;
    responseBody?: any;
    error?: string;
    timestamp: number;
}

/**
 * Truncate large bodies to prevent database bloat
 */
function truncateBody(body: any): string {
    if (!body) return '';

    let bodyStr: string;

    if (typeof body === 'string') {
        bodyStr = body;
    } else if (Buffer.isBuffer(body)) {
        bodyStr = body.toString('utf8', 0, Math.min(body.length, MAX_BODY_SIZE));
    } else {
        bodyStr = JSON.stringify(body);
    }

    if (bodyStr.length > MAX_BODY_SIZE) {
        const truncated = bodyStr.substring(0, MAX_BODY_SIZE);
        return truncated + '\n\n[TRUNCATED - Original size: ' + bodyStr.length + ' bytes]';
    }

    return bodyStr;
}

/**
 * Serialize headers to JSON string
 */
function serializeHeaders(headers?: Record<string, string | string[]>): string {
    if (!headers) return '{}';

    try {
        return JSON.stringify(headers);
    } catch (error) {
        console.error('[LOGGER] Error serializing headers:', error);
        return '{}';
    }
}

/**
 * Log request to database
 */
export function logRequest(data: LogRequestData): void {
    const insertStmt = db.prepare(`
        INSERT INTO requests (
            session_id,
            method,
            path,
            status_code,
            duration_ms,
            request_headers,
            request_body,
            response_headers,
            response_body,
            error,
            timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
        const requestBody = truncateBody(data.requestBody);
        const responseBody = truncateBody(data.responseBody);
        const requestHeaders = serializeHeaders(data.requestHeaders);
        const responseHeaders = serializeHeaders(data.responseHeaders);

        insertStmt.run(
            data.sessionId,
            data.method,
            data.path,
            data.statusCode ?? null,
            data.durationMs ?? null,
            requestHeaders,
            requestBody,
            responseHeaders,
            responseBody,
            data.error ?? null,
            data.timestamp
        );

        console.log(`[LOGGER] Logged: ${data.method} ${data.path} - ${data.statusCode ?? 'error'} (${data.durationMs ?? 0}ms)`);
    } catch (error) {
        console.error('[LOGGER] Error inserting request to database:', error);
        console.error('[LOGGER] Failed request data:', {
            method: data.method,
            path: data.path,
            sessionId: data.sessionId
        });
    }
}

/**
 * Get or create session
 */
export function getOrCreateSession(sessionId: string, name?: string): string {
    const selectStmt = db.prepare('SELECT id FROM sessions WHERE id = ?');
    const existing = selectStmt.get(sessionId);

    if (!existing) {
        const insertStmt = db.prepare(`
            INSERT INTO sessions (id, name) VALUES (?, ?)
        `);

        try {
            insertStmt.run(sessionId, name ?? `Session ${sessionId.substring(0, 8)}`);
            console.log(`[LOGGER] Created new session: ${sessionId}`);
        } catch (error) {
            console.error('[LOGGER] Error creating session:', error);
        }
    }

    return sessionId;
}

/**
 * Update session request count
 */
export function updateSessionCount(sessionId: string): void {
    const updateStmt = db.prepare(`
        UPDATE sessions 
        SET request_count = (
            SELECT COUNT(*) FROM requests WHERE session_id = ?
        )
        WHERE id = ?
    `);

    try {
        updateStmt.run(sessionId, sessionId);
    } catch (error) {
        console.error('[LOGGER] Error updating session count:', error);
    }
}

/**
 * Get requests with optional filtering
 */
export interface RequestFilters {
    method?: string;
    path?: string;
    statusCode?: number;
    sessionId?: string;
    limit?: number;
}

export function getRequests(filters: RequestFilters = {}): any[] {
    const {
        method,
        path,
        statusCode,
        sessionId,
        limit = 100
    } = filters;

    let query = 'SELECT * FROM requests WHERE 1=1';
    const params: any[] = [];

    if (method) {
        query += ' AND method = ?';
        params.push(method.toUpperCase());
    }

    if (path) {
        query += ' AND path LIKE ?';
        params.push(`%${path}%`);
    }

    if (statusCode !== undefined) {
        query += ' AND status_code = ?';
        params.push(statusCode);
    }

    if (sessionId) {
        query += ' AND session_id = ?';
        params.push(sessionId);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    try {
        const selectStmt = db.prepare(query);
        const results = selectStmt.all(...params);

        // Parse JSON fields back to objects and transform to camelCase
        return results.map((req: any) => ({
            id: req.id,
            sessionId: req.session_id,
            method: req.method,
            path: req.path,
            statusCode: req.status_code,
            durationMs: req.duration_ms,
            requestHeaders: req.request_headers ? JSON.parse(req.request_headers) : {},
            requestBody: req.request_body,
            responseHeaders: req.response_headers ? JSON.parse(req.response_headers) : {},
            responseBody: req.response_body,
            error: req.error,
            timestamp: req.timestamp,
            createdAt: req.created_at
        }));
    } catch (error) {
        console.error('[LOGGER] Error fetching requests:', error);
        return [];
    }
}

/**
 * Get unique endpoints (method + path combinations)
 */
export function getUniqueEndpoints(): Array<{ method: string; path: string; count: number; }> {
    const query = `
        SELECT 
            method,
            path,
            COUNT(*) as count
        FROM requests
        GROUP BY method, path
        ORDER BY count DESC
    `;

    try {
        const selectStmt = db.prepare(query);
        return selectStmt.all() as Array<{ method: string; path: string; count: number; }>;
    } catch (error) {
        console.error('[LOGGER] Error fetching unique endpoints:', error);
        return [];
    }
}

/**
 * Get all requests for a specific endpoint
 */
export function getEndpointRequests(method: string, path: string, limit: number = 100): any[] {
    const query = `
        SELECT * FROM requests
        WHERE method = ? AND path = ?
        ORDER BY timestamp DESC
        LIMIT ?
    `;

    try {
        const selectStmt = db.prepare(query);
        const results = selectStmt.all(method.toUpperCase(), path, limit);

        return results.map((req: any) => ({
            id: req.id,
            sessionId: req.session_id,
            method: req.method,
            path: req.path,
            statusCode: req.status_code,
            durationMs: req.duration_ms,
            requestHeaders: req.request_headers ? JSON.parse(req.request_headers) : {},
            requestBody: req.request_body,
            responseHeaders: req.response_headers ? JSON.parse(req.response_headers) : {},
            responseBody: req.response_body,
            error: req.error,
            timestamp: req.timestamp,
            createdAt: req.created_at
        }));
    } catch (error) {
        console.error('[LOGGER] Error fetching endpoint requests:', error);
        return [];
    }
}
