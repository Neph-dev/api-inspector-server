/**
 * Type definitions for shape analysis
 */
export type ShapeValue =
    | string
    | ShapeObject
    | ShapeArray
    | null;

export interface ShapeObject {
    [key: string]: ShapeValue;
}

export interface ShapeArray extends Array<ShapeValue> { }

/**
 * Get the type name for a primitive value
 */
function getTypeName(value: any): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';

    const type = typeof value;

    if (type === 'object') return 'object';
    if (type === 'number') {
        return Number.isInteger(value) ? 'number' : 'number';
    }
    if (type === 'boolean') return 'boolean';
    if (type === 'string') return 'string';

    return 'unknown';
}

/**
 * Extract shape from an array
 * Infers type from first element
 */
function extractArrayShape(arr: any[]): ShapeValue {
    if (arr.length === 0) {
        return ['unknown'];
    }

    const firstElement = arr[0];
    const firstType = getTypeName(firstElement);

    if (firstType === 'object') {
        return [extractShape(firstElement)];
    } else if (firstType === 'array') {
        return [extractArrayShape(firstElement)];
    } else {
        return [firstType];
    }
}

/**
 * Extract shape from a JSON object
 * Returns a schema representation of the object structure
 * 
 * @param jsonObject - The object to analyze
 * @returns A shape representation
 * 
 * @example
 * extractShape({ name: "John", age: 30, tags: ["a", "b"] })
 * // Returns: { name: "string", age: "number", tags: ["string"] }
 * 
 * @example
 * extractShape({ user: { id: 1, profile: { bio: "text" } } })
 * // Returns: { user: { id: "number", profile: { bio: "string" } } }
 */
export function extractShape(jsonObject: any): ShapeValue {
    // Handle null and undefined
    if (jsonObject === null) return 'null';
    if (jsonObject === undefined) return 'undefined';

    const type = getTypeName(jsonObject);

    // Handle primitives
    if (type !== 'object' && type !== 'array') {
        return type;
    }

    // Handle arrays
    if (Array.isArray(jsonObject)) {
        return extractArrayShape(jsonObject);
    }

    // Handle objects - recursively extract shape
    const shape: ShapeObject = {};

    for (const key in jsonObject) {
        if (jsonObject.hasOwnProperty(key)) {
            const value = jsonObject[key];
            const valueType = getTypeName(value);

            if (valueType === 'object') {
                // Recursively extract nested object shape
                shape[key] = extractShape(value);
            } else if (valueType === 'array') {
                // Extract array shape
                shape[key] = extractArrayShape(value);
            } else {
                // Primitive type
                shape[key] = valueType;
            }
        }
    }

    return shape;
}

/**
 * Diff detection and inconsistency analysis
 */

export interface GroupedEndpoint {
    method: string;
    path: string;
    requestCount: number;
    shapes: ShapeValue[];
    firstSeen: number;
    lastSeen: number;
    statusCodes: number[];
    avgDuration: number;
}

export interface ShapeDiff {
    missingFields: string[];
    typeChanges: Array<{ field: string; types: string[]; }>;
    extraFields: string[];
}

export interface EndpointDiffAnalysis {
    endpoint: string;
    inconsistencies: string[];
    shapes: ShapeValue[];
    totalShapes: number;
}

/**
 * Get all field paths from a shape
 */
function getFieldPaths(shape: ShapeValue, prefix: string = ''): Set<string> {
    const paths = new Set<string>();

    if (typeof shape === 'string') {
        if (prefix) paths.add(prefix);
        return paths;
    }

    if (Array.isArray(shape)) {
        if (prefix) paths.add(prefix);
        return paths;
    }

    if (typeof shape === 'object' && shape !== null) {
        for (const key in shape) {
            const fieldPath = prefix ? `${prefix}.${key}` : key;
            paths.add(fieldPath);

            // Recursively get nested paths
            const nestedPaths = getFieldPaths(shape[key], fieldPath);
            nestedPaths.forEach(p => {
                if (p !== fieldPath) paths.add(p);
            });
        }
    }

    return paths;
}

/**
 * Get the type at a specific field path
 */
function getTypeAtPath(shape: ShapeValue, path: string): string {
    const parts = path.split('.');
    let current: any = shape;

    for (const part of parts) {
        if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
            current = current[part];
        } else {
            return 'unknown';
        }
    }

    if (typeof current === 'string') return current;
    if (Array.isArray(current)) return 'array';
    if (typeof current === 'object' && current !== null) return 'object';
    return 'unknown';
}

/**
 * Analyze all shapes for an endpoint and detect inconsistencies
 */
export function analyzeEndpointDiffs(endpoint: GroupedEndpoint): EndpointDiffAnalysis {
    const inconsistencies: string[] = [];
    const { shapes, method, path } = endpoint;

    if (shapes.length <= 1) {
        return {
            endpoint: `${method} ${path}`,
            inconsistencies: [],
            shapes,
            totalShapes: shapes.length
        };
    }

    // Use the first shape as the baseline
    const baseShape = shapes[0];
    const allFields = new Set<string>();
    const fieldOccurrences = new Map<string, number>();
    const fieldTypes = new Map<string, Set<string>>();

    // Collect all fields and their types across all shapes
    for (const shape of shapes) {
        const fields = getFieldPaths(shape);

        for (const field of fields) {
            allFields.add(field);
            fieldOccurrences.set(field, (fieldOccurrences.get(field) || 0) + 1);

            if (!fieldTypes.has(field)) {
                fieldTypes.set(field, new Set());
            }

            const type = getTypeAtPath(shape, field);
            fieldTypes.get(field)!.add(type);
        }
    }

    // Detect inconsistencies
    for (const field of allFields) {
        const occurrences = fieldOccurrences.get(field) || 0;
        const types = fieldTypes.get(field)!;

        // Field missing in some responses
        if (occurrences < shapes.length) {
            const missingCount = shapes.length - occurrences;
            inconsistencies.push(`field '${field}' missing in ${missingCount} response${missingCount > 1 ? 's' : ''}`);
        }

        // Type changes detected
        if (types.size > 1) {
            const typeList = Array.from(types).join(', ');
            inconsistencies.push(`field '${field}' has inconsistent types: ${typeList}`);
        }
    }

    return {
        endpoint: `${method} ${path}`,
        inconsistencies,
        shapes,
        totalShapes: shapes.length
    };
}
