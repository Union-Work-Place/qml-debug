/** Breakpoint payload returned by the legacy Qt V8 bridge. */
export interface QmlBreakpoint
{
    /** Numeric breakpoint id assigned by the runtime. */
    breakpoint : number;
    /** Breakpoint type reported by the runtime. */
    type : string;
}

/** Check whether a value matches the legacy breakpoint payload shape. */
export function isQmlBreakpoint(value : any) : value is QmlBreakpoint
{
    if (typeof value !== "object" ||
        typeof value.breakpoint !== "number" ||
        typeof value.type !== "string")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Backtrace payload returned by the legacy Qt V8 bridge. */
export interface QmlBacktrace
{
    /** Index of the first frame in the response. */
    fromFrame : number;
    /** Index after the last frame in the response. */
    toFrame : number;
    /** Collected stack frames. */
    frames : QmlFrame[];
}

/** Check whether a value matches the legacy backtrace payload shape. */
export function isQmlBacktrace(value : any) : value is QmlBacktrace
{
    if (typeof value !== "object" ||
        typeof value.fromFrame !== "number" ||
        typeof value.toFrame !== "number" ||
        !Array.isArray(value.frames))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    for (const frame of value.frames)
    {
        if (!isQmlFrame(frame))
            return false;
    }

    return true;
}

/** One stack frame returned by the legacy Qt V8 bridge. */
export interface QmlFrame
{
    /** Frame index inside the current backtrace window. */
    index : number;
    /** Function or binding name. */
    func : string;
    /** Script path or URL. */
    script : string;
    /** 0-based source line reported by the runtime. */
    line: number;
    /** Whether the frame belongs to the debugger implementation itself. */
    debuggerFrame : boolean;
    /** Scope references associated with the frame. */
    scopes : QmlScope[];
}

/** Check whether a value matches the legacy frame payload shape. */
export function isQmlFrame(value : any) : value is QmlFrame
{
    if (typeof value !== "object" ||
        typeof value.index !== "number" ||
        typeof value.func !== "string" ||
        typeof value.script !== "string" ||
        typeof value.line !== "number" ||
        typeof value.debuggerFrame !== "boolean")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    if (value.scopes !== undefined)
    {
        if (!Array.isArray(value.scopes))
            return false;

        for (const scope of value.scopes)
        {
            if (!isQmlScope(scope))
                return false;
        }
    }

    return true;
}

/** One scope descriptor returned for a frame. */
export interface QmlScope
{
    /** Frame index that owns the scope. */
    frameIndex : number;
    /** Scope index used for follow-up requests. */
    index : number;
    /** Numeric scope type reported by the runtime. */
    type : number;
    /** Optional materialized scope object. */
    object? : QmlVariable;
}

/** Check whether a value matches the legacy scope payload shape. */
export function isQmlScope(value : any) : value is QmlScope
{
    if (typeof value !== "object" ||
        typeof value.index !== "number" ||
        typeof value.type !== "number")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    if (value.frameIndex !== undefined && typeof value.frameIndex !== "number")
        return false;

    if (value.object !== undefined)
    {

        if (value.object.handle !== undefined && typeof value.object.handle !== "number")
            return false;

        if (!isQmlVariable(value.object))
            return false;
    }

    return true;
}

/** Variable or object payload returned by lookup/evaluate/scope requests. */
export interface QmlVariable
{
    /** Runtime object handle used for follow-up lookup requests. */
    handle : number;
    /** Variable name, when one is available. */
    name? : string;
    /** Runtime type name. */
    type : string;
    /** Raw variable value or display text. */
    value : any;
    /** Optional nested-reference handle. */
    ref? : number;
    /** Optional inline child properties. */
    properties? : QmlVariable[];
}

/** Check whether a value matches the legacy variable payload shape. */
export function isQmlVariable(value : any) : value is QmlVariable
{
    if (typeof value !== "object" ||
        typeof value.type !== "string")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    if (value.type !== "undefined" && value.value === undefined)
        return false;

    if (value.ref !== undefined && typeof value.ref !== "number")
        return false;

    if (value.properties !== undefined)
    {
        if (!Array.isArray(value.properties))
            return false;

        for (const property of value.properties)
        {
            if (!isQmlVariable(property))
                return false;
        }
    }

    return true;
}
