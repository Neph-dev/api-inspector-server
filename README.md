# API Inspector Server

A development tool that acts as a reverse proxy for API inspection, logging, and analysis. Intercepts HTTP traffic between clients and backend services to provide detailed insights into API behavior, response consistency, and performance metrics.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Installation](#installation)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [Database Schema](#database-schema)
- [Core Modules](#core-modules)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

---

## Overview

The API Inspector Server is a TypeScript-based Express application that:

- **Proxies HTTP requests** to a target backend server
- **Logs all traffic** (requests/responses) to a SQLite database
- **Analyzes response shapes** to detect inconsistencies across API calls
- **Tracks performance metrics** including latency statistics
- **Provides REST APIs** for querying captured data

### Key Features

✅ **Request/Response Logging** - Full capture of headers, bodies, and metadata  
✅ **Shape Analysis** - Automatic detection of response schema inconsistencies  
✅ **Latency Tracking** - Per-endpoint performance metrics  
✅ **Session Management** - Organize requests by session for easier debugging  
✅ **SQLite Storage** - Persistent storage with WAL mode for performance  
✅ **CORS Enabled** - Ready for cross-origin frontend integration  

---

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│   Client    │────────▶│  API Inspector   │────────▶│   Backend   │
│  (Browser)  │         │  (Port 9000)     │         │ (Port 3002) │
└─────────────┘         └──────────────────┘         └─────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │   SQLite DB  │
                        │ (inspector.db)│
                        └──────────────┘
```

### Request Flow

1. **Incoming Request**: Client sends HTTP request to port 9000
2. **Metadata Capture**: Middleware extracts request details (method, path, headers, body)
3. **Proxy Forward**: Request is forwarded to target backend (port 3002)
4. **Response Capture**: Response headers and body are intercepted
5. **Database Logging**: Full request/response cycle is persisted to SQLite
6. **Client Response**: Original response is returned to client

---

## Installation

### Prerequisites

- Node.js v20.9.0 or higher
- npm or yarn

### Steps

```bash
# Clone/navigate to server directory
cd /path/to/api-inspector/server

# Install dependencies
npm install

# Start development server
npm run dev
```

### Dependencies

**Production:**
- `express` (^5.1.0) - Web framework
- `http-proxy-middleware` (^3.0.5) - Proxy functionality
- `better-sqlite3` (^12.4.1) - SQLite database driver
- `cors` (^2.8.5) - CORS middleware

**Development:**
- `typescript` (^5.9.3) - TypeScript compiler
- `ts-node-dev` (^2.0.0) - Development server with auto-reload
- Type definitions for all dependencies

---

## Configuration

### Environment Variables

Currently configured via constants in `server.ts`:

```typescript
const PORT = 9000;              // Server listening port
const TARGET_URL = 'http://localhost:3002';  // Backend proxy target
```

### Database Configuration

Located in `db/init.ts`:

```typescript
const DB_PATH = path.join(__dirname, 'inspector.db');

// Performance optimizations
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');  // Write-Ahead Logging
```

---

## API Endpoints

All API routes are prefixed with `/api` and return JSON responses.

### 1. Get Requests

**Endpoint:** `GET /api/requests`

**Description:** Retrieve logged requests with optional filtering.

**Query Parameters:**
- `method` (string, optional) - Filter by HTTP method (GET, POST, etc.)
- `path` (string, optional) - Filter by URL path (partial match)
- `status` (number, optional) - Filter by HTTP status code
- `session` (string, optional) - Filter by session ID

**Response Format:**
```json
{
  "success": true,
  "count": 42,
  "data": [
    {
      "id": 1,
      "sessionId": "6dab33cb8dacf1fb2021a8c5ed0ad244",
      "method": "GET",
      "path": "/api/users/123",
      "statusCode": 200,
      "durationMs": 145,
      "requestHeaders": { "content-type": "application/json" },
      "requestBody": "",
      "responseHeaders": { "content-type": "application/json" },
      "responseBody": "{\"id\":123,\"name\":\"John\"}",
      "error": null,
      "timestamp": 1700000000000,
      "createdAt": "2024-11-15T00:00:00.000Z"
    }
  ]
}
```

**Example Usage:**
```bash
# Get all requests
curl http://localhost:9000/api/requests

# Get POST requests to /api/users
curl "http://localhost:9000/api/requests?method=POST&path=/api/users"

# Get failed requests (500 errors)
curl "http://localhost:9000/api/requests?status=500"
```

---

### 2. Get Diffs

**Endpoint:** `GET /api/diffs`

**Description:** Analyze response shape inconsistencies across endpoints.

**Response Format:**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "method": "GET",
      "path": "/api/users",
      "totalResponses": 5,
      "inconsistencies": {
        "missingFields": [
          {
            "field": "email",
            "path": "email",
            "type": "missing"
          }
        ],
        "typeChanges": [
          {
            "field": "age",
            "path": "age",
            "type": "type_change",
            "expectedType": "number",
            "actualType": "string"
          }
        ],
        "extraFields": []
      },
      "baseShape": {
        "id": "number",
        "name": "string",
        "email": "string",
        "age": "number"
      },
      "variantShapes": [
        {
          "id": "number",
          "name": "string",
          "age": "string"
        }
      ]
    }
  ]
}
```

**How It Works:**
1. Queries all unique endpoints from database
2. Fetches last 100 requests per endpoint
3. Extracts JSON response shapes for successful requests (200-299)
4. Compares shapes to detect:
   - **Missing fields**: Fields present in some responses but not others
   - **Type changes**: Same field with different data types
   - **Extra fields**: Additional fields in variant responses

**Example Usage:**
```bash
curl http://localhost:9000/api/diffs
```

---

### 3. Get Latency Statistics

**Endpoint:** `GET /api/stats/latency`

**Description:** Get average, min, and max latency per endpoint.

**Response Format:**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "endpoint": "GET /api/users",
      "method": "GET",
      "path": "/api/users",
      "avgLatency": 125.5,
      "minLatency": 45,
      "maxLatency": 320,
      "count": 42
    }
  ]
}
```

**Metrics Calculated:**
- `avgLatency`: Mean response time in milliseconds
- `minLatency`: Fastest response time observed
- `maxLatency`: Slowest response time observed
- `count`: Number of requests used for calculation

**Example Usage:**
```bash
curl http://localhost:9000/api/stats/latency
```

---

### 4. Proxy All Other Requests

**Endpoint:** `* /*` (wildcard - all non-API routes)

**Description:** Forwards all requests to the target backend server.

**Behavior:**
- Captures request metadata before proxying
- Logs full request/response cycle to database
- Returns original backend response to client
- Handles proxy errors gracefully (502 on backend unreachable)

---

## Database Schema

SQLite database located at `db/inspector.db`

### Tables

#### `requests`
Stores all intercepted HTTP requests and responses.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Auto-increment unique ID |
| `session_id` | TEXT NOT NULL | Session identifier |
| `method` | TEXT NOT NULL | HTTP method (GET, POST, etc.) |
| `path` | TEXT NOT NULL | URL path |
| `status_code` | INTEGER | HTTP status code |
| `duration_ms` | INTEGER | Request duration in milliseconds |
| `request_headers` | TEXT | JSON string of request headers |
| `request_body` | TEXT | Request body (truncated if > 1MB) |
| `response_headers` | TEXT | JSON string of response headers |
| `response_body` | TEXT | Response body (truncated if > 1MB) |
| `error` | TEXT | Error message if request failed |
| `timestamp` | INTEGER NOT NULL | Unix timestamp (ms) |
| `created_at` | DATETIME | Database insertion timestamp |

**Indexes:**
- `idx_requests_session_id` - Fast session queries
- `idx_requests_timestamp` - Chronological sorting
- `idx_requests_method` - Method filtering
- `idx_requests_status_code` - Status code filtering

#### `sessions`
Tracks request sessions for organizational purposes.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Unique session ID (32-char hex) |
| `name` | TEXT | Human-readable session name |
| `started_at` | DATETIME | Session creation time |
| `ended_at` | DATETIME | Session end time (nullable) |
| `request_count` | INTEGER | Number of requests in session |

---

## Core Modules

### 1. Server (`server.ts`)

**Responsibilities:**
- Express app initialization
- CORS configuration
- Request metadata capture middleware
- API route definitions
- Proxy middleware setup
- Session management

**Key Components:**

```typescript
// Session initialization
const CURRENT_SESSION_ID = randomBytes(16).toString('hex');
getOrCreateSession(CURRENT_SESSION_ID, `Session ${new Date().toISOString()}`);

// Metadata tracking
const requestMetadataMap = new Map<string, RequestMetadata>();

// Body parsing (up to 10MB)
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb' }));
app.use(express.raw({ limit: '10mb' }));
```

---

### 2. Database (`db/init.ts`)

**Responsibilities:**
- SQLite connection management
- Schema initialization
- Performance optimization
- Graceful shutdown handling

**Features:**
- **WAL Mode**: Write-Ahead Logging for better concurrency
- **Foreign Keys**: Enabled for referential integrity
- **Auto-initialization**: Creates tables on first run
- **Signal Handling**: Proper cleanup on SIGINT/SIGTERM

---

### 3. Logger (`logger/index.ts`)

**Responsibilities:**
- Request/response persistence
- Data retrieval with filtering
- Session management
- Body truncation (prevents DB bloat)

**Exported Functions:**

```typescript
// Write operations
logRequest(data: LogRequestData): void
getOrCreateSession(sessionId: string, name?: string): string
updateSessionCount(sessionId: string): void

// Read operations
getRequests(filters: RequestFilters): any[]
getUniqueEndpoints(): Array<{ method: string; path: string; count: number }>
getEndpointRequests(method: string, path: string, limit: number): any[]
```

**Key Features:**
- Automatic body truncation at 1MB threshold
- JSON serialization for headers
- camelCase transformation for client compatibility
- SQL injection protection via prepared statements

---

### 4. Diff Analyzer (`diff/analyzer.ts`)

**Responsibilities:**
- JSON shape extraction
- Inconsistency detection
- Type analysis

**Core Algorithm:**

```typescript
// Extract shape from JSON response
extractShape({ name: "John", age: 30, tags: ["a", "b"] })
// Returns: { name: "string", age: "number", tags: ["string"] }

// Analyze endpoint for inconsistencies
analyzeEndpointDiffs(endpoint: GroupedEndpoint): EndpointDiffAnalysis
// Returns: { endpoint, inconsistencies, shapes, totalShapes }
```

**Shape Types:**
- Primitives: `"string"`, `"number"`, `"boolean"`, `"null"`
- Objects: `{ key1: "type1", key2: "type2" }`
- Arrays: `["elementType"]`
- Nested: Full recursive structure

**Inconsistency Detection:**
1. Collect all field paths from all shapes
2. Track field occurrences and types
3. Report missing fields (present in <100% of responses)
4. Report type changes (same field with multiple types)

---

## Development

### Project Structure

```
server/
├── db/
│   ├── init.ts              # Database initialization
│   └── inspector.db         # SQLite database file
├── diff/
│   └── analyzer.ts          # Shape extraction & diff analysis
├── logger/
│   └── index.ts             # Database operations
├── server.ts                # Main application entry point
├── package.json             # Dependencies & scripts
└── tsconfig.json            # TypeScript configuration
```

### Running in Development

```bash
npm run dev
```

Uses `ts-node-dev` for:
- Auto-restart on file changes
- TypeScript compilation on-the-fly
- Source map support for debugging

### Building for Production

```bash
npm run build
```

Compiles TypeScript to JavaScript in `dist/` directory.

---

## Troubleshooting

### Common Issues

#### 1. Port Already in Use

**Error:** `EADDRINUSE: address already in use :::9000`

**Solution:**
```bash
# Find and kill process using port 9000
lsof -ti:9000 | xargs kill -9

# Or change PORT in server.ts
```

#### 2. Database Locked

**Error:** `SQLITE_BUSY: database is locked`

**Solution:**
- WAL mode should prevent this, but if it occurs:
```bash
# Stop server
# Delete WAL files
rm db/inspector.db-wal db/inspector.db-shm
# Restart server
```

#### 3. better-sqlite3 Module Version Mismatch

**Error:** `NODE_MODULE_VERSION mismatch`

**Solution:**
```bash
# Rebuild native module for current Node version
npm rebuild better-sqlite3
```

#### 4. Backend Connection Failed

**Error:** `ECONNREFUSED` or 502 errors

**Check:**
- Backend server is running on port 3002
- Update `TARGET_URL` if backend is on different port
- Verify network accessibility

#### 5. Database Size Growing Too Large

**Solution:**
```bash
# Clear old data
sqlite3 db/inspector.db "DELETE FROM requests WHERE timestamp < strftime('%s', 'now', '-7 days') * 1000"
sqlite3 db/inspector.db "VACUUM"
```

---

## Performance Considerations

### Request Body Limits

Both request and response bodies are limited to **10MB** to prevent memory issues. This can be adjusted in `server.ts`:

```typescript
app.use(express.json({ limit: '10mb' }));  // Increase as needed
```

### Body Truncation

Bodies larger than **1MB** are automatically truncated before database storage:

```typescript
const MAX_BODY_SIZE = 1024 * 1024; // 1MB
```

Truncated bodies include metadata about original size.

### Database Optimization

- **WAL Mode**: Allows concurrent reads during writes
- **Indexes**: Optimized for common query patterns
- **Prepared Statements**: Prevent SQL injection and improve performance

### Memory Management

- Request metadata is stored in a `Map` and cleaned up after response
- Body streaming prevents large payloads from overwhelming memory
- Session management uses minimal storage

---

## API Response Format

All API endpoints follow this standard format:

**Success Response:**
```json
{
  "success": true,
  "count": 10,
  "data": [...]
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Failed to fetch requests",
  "message": "Detailed error message"
}
```

**HTTP Status Codes:**
- `200 OK` - Successful operation
- `500 Internal Server Error` - Server error (logged to console)
- `502 Bad Gateway` - Backend proxy error

---

## Logging

Console output uses prefixes for easy filtering:

- `[SERVER]` - Server initialization/status
- `[DB]` - Database operations
- `[SESSION]` - Session management
- `[PROXY]` - Outgoing proxy requests
- `[RESPONSE]` - Incoming proxy responses
- `[ERROR]` - Error conditions
- `[API]` - API endpoint handling
- `[LOGGER]` - Database logging operations

**Example Console Output:**
```
[DB] Database initialized successfully
[LOGGER] Created new session: 6dab33cb8dacf1fb2021a8c5ed0ad244
[SESSION] Active session: 6dab33cb8dacf1fb2021a8c5ed0ad244
[SERVER] API Inspector running on http://localhost:9000
[PROXY] Forwarding all requests to http://localhost:3002
[PROXY] GET /api/users -> http://localhost:3002/api/users
[RESPONSE] GET /api/users - 200 - 145ms
[LOGGER] Logged: GET /api/users - 200 (145ms)
```

---

## Security Considerations

⚠️ **This tool is intended for local development only**

- No authentication/authorization
- Stores sensitive data (headers, bodies) unencrypted
- CORS enabled for all origins
- Not hardened for production use

**Best Practices:**
- Use only in trusted development environments
- Don't proxy production traffic
- Clear database regularly to avoid sensitive data accumulation
- Don't commit `inspector.db` to version control

---

## Future Enhancements

Potential improvements:

- [ ] Authentication for API endpoints
- [ ] Request replay functionality
- [ ] Export requests as cURL/Postman collections
- [ ] Real-time WebSocket updates
- [ ] Request/response diffing
- [ ] Custom rules for validation
- [ ] Response mocking capabilities
- [ ] Performance baseline tracking
- [ ] GraphQL introspection support

---

## License

ISC

## Author

Nephthali Salam

---

## Related Components

This server works in conjunction with:

- **Client UI** (`/client`) - Next.js frontend for visualizing captured data
- **Mock Backend** (`mock-backend-simple.js`) - Test backend for development

For complete system documentation, see the main project README.
