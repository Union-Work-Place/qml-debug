import
{
    QmlBacktrace,
    isQmlBacktrace,
    QmlFrame,
    isQmlFrame,
    QmlScope,
    isQmlScope,
    QmlVariable,
    isQmlVariable,
    QmlBreakpoint,
    isQmlBreakpoint
} from "@qml-debug/qml-types";


// MESSAGE
///////////////////////////////////////////////////////////////////////

/** Base message shape shared by all legacy V8 bridge packets. */
export interface QmlMessage
{
    /** Packet kind emitted by the runtime. */
    type : "request" | "event" | "response";
    /** Monotonic sequence id assigned by sender. */
    seq : number;
}

/** Check whether a value matches the common message envelope. */
export function isQmlMessage(value : any) : value is QmlMessage
{
    if (typeof value !== "object" ||
        typeof value.type !== "string" ||
        typeof value.seq !== "number")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}


// REQUEST
///////////////////////////////////////////////////////////////////////

/** Generic legacy request envelope. */
export interface QmlRequest<QmlArgumentsType> extends QmlMessage
{
    /** Request packet marker. */
    type : "request";
    /** Command name understood by the runtime. */
    command : string;
    /** Command-specific argument payload. */
    arguments : QmlArgumentsType;
}

/** Check whether a value matches the generic request envelope. */
export function isQmlRequest(value : any) : value is QmlRequest<any>
{
    if (!isQmlMessage(value) ||
        value.type !== "request" ||
        typeof (value as any).arguments !== "object")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}


// RESPONSE
///////////////////////////////////////////////////////////////////////

/** Generic legacy response envelope. */
export interface QmlResponse<QmlResponseBody> extends QmlMessage
{
    /** Response packet marker. */
    type : "response";
    /* eslint-disable */
    /** Sequence id of the request being answered. */
    request_seq : number;
    /* eslint-enable */
    /** Command name being answered. */
    command : string;
    /** Whether the command succeeded. */
    success : boolean;
    /** Whether the runtime is left running after the response. */
    running : boolean;
    /** Command-specific response body. */
    body : QmlResponseBody;
}

/** Check whether a value matches the generic response envelope. */
export function isQmlResponse(value : any) : value is QmlResponse<any>
{
    if (!isQmlMessage(value as any) ||
        value.type !== "response" ||
        typeof value.request_seq !== "number" ||
        typeof value.command !== "string" ||
        typeof value.success !== "boolean" ||
        typeof value.running !== "boolean")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}


// EVENT
///////////////////////////////////////////////////////////////////////

/** Generic legacy event envelope. */
export interface QmlEvent<QmlEventBody> extends QmlMessage
{
    /** Event packet marker. */
    type : "event";
    /** Event name emitted by the runtime. */
    event : string;
    /** Event-specific body payload. */
    body : QmlEventBody;
}

/** Check whether a value matches the generic event envelope. */
export function isQmlEvent<QmlEventBody>(value : any) : value is QmlEvent<QmlEventBody>
{
    if (!isQmlMessage(value as any) ||
        value.type !== "event" ||
        typeof value.event !== "string")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}


// VERSION
///////////////////////////////////////////////////////////////////////

/** Version request sent after the V8 debugger handshake. */
export type QmlVersionRequest = QmlRequest<null>;

/** Check whether a value matches the version request shape. */
export function isQmlVersionRequest(value : any) : value is QmlVersionRequest
{
    if (!isQmlRequest(value) ||
        value.command !== "version" ||
        value.arguments !== null)
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Capability flags returned by the legacy V8 version command. */
export interface QmlVersionBody
{
    /* eslint-disable */
    ChangeBreakpoint : boolean;
    ContextEvaluate : boolean;
    UnpausedEvaluate : boolean;
    V8Version : string;
    /* eslint-enable */
}

/** Check whether a value matches the version response body. */
export function isQmlVersionBody(value : any) : value is QmlVersionBody
{
    if (typeof value !== "object" ||
        typeof value.ChangeBreakpoint !== "boolean" ||
        typeof value.ContextEvaluate !== "boolean" ||
        typeof value.UnpausedEvaluate !== "boolean" ||
        typeof value.V8Version !== "string")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Version response envelope returned by the runtime. */
export interface QmlVersionResponse extends QmlResponse<QmlVersionBody>
{
    /** Version command name. */
    command : "version";
}

/** Check whether a value matches the version response shape. */
export function isQmlVersionResponse(value : any) : value is QmlVersionResponse
{
    if (!isQmlResponse(value) ||
        value.command !== "version" ||
        !isQmlVersionBody(value.body))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}


// SET BREAKPOINT
///////////////////////////////////////////////////////////////////////

/** Arguments for the legacy setbreakpoint command. */
export interface QmlSetBreakpointArguments
{
    /** Breakpoint target type. */
    type : string;
    /** Script identifier or regexp target. */
    target : string;
    /** 0-based source line. */
    line : number;
    /** Whether the breakpoint starts enabled. */
    enabled : boolean;
    /** Ignore count requested by the client. */
    ignoreCount : number;
}

/** Check whether a value matches setbreakpoint arguments. */
export function isQmlSetBreakpointArguments(value : any) : value is QmlSetBreakpointArguments
{
    if (typeof value !== "object" ||
        typeof value.type !== "string" ||
        typeof value.target !== "string" ||
        typeof value.line !== "number" ||
        typeof value.ignoreCount !== "number" ||
        typeof value.enabled !== "boolean")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Request envelope for the setbreakpoint command. */
export type QmlSetBreakpointRequest = QmlRequest<QmlSetBreakpointArguments>;

/** Check whether a value matches the setbreakpoint request shape. */
export function isQmlSetBreakpointRequest(value : any) : value is QmlSetBreakpointRequest
{
    if (!isQmlRequest(value) ||
        value.command !== "setbreakpoint" ||
        !isQmlSetBreakpointArguments(value.arguments))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Response envelope returned by the setbreakpoint command. */
export interface QmlSetBreakpointResponse extends QmlResponse<QmlBreakpoint>
{
    /** Command name echoed by the runtime. */
    command : "setbreakpoint";
}

/** Check whether a value matches the setbreakpoint response shape. */
export function isQmlSetBreakpointResponse(value : any) : value is QmlSetBreakpointResponse
{
    if (!isQmlResponse(value) ||
        value.command !== "setbreakpoint" ||
        !isQmlBreakpoint(value.body))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}


// CLEAR BREAKPOINT
///////////////////////////////////////////////////////////////////////

/** Arguments for the clearbreakpoint command. */
export interface QmlClearBreakpointArguments
{
    /** Breakpoint id to remove. */
    breakpoint : number;
}

/** Check whether a value matches clearbreakpoint arguments. */
export function isQmlCancelBreakpointArguments(value : any) : value is QmlClearBreakpointArguments
{
    if (typeof value !== "object" ||
        typeof value.breakpoint !== "number")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Backward-compatible alias with a corrected name for clearbreakpoint arguments. */
export const isQmlClearBreakpointArguments = isQmlCancelBreakpointArguments;

/** Request envelope for the clearbreakpoint command. */
export type QmlClearBreakpointRequest = QmlRequest<QmlClearBreakpointArguments>;

/** Check whether a value matches the clearbreakpoint request shape. */
export function isQmlClearBreakpointRequest(value : any) : value is QmlClearBreakpointRequest
{
    if (!isQmlRequest(value) ||
        value.command !== "clearbreakpoint" ||
        !isQmlCancelBreakpointArguments(value.arguments))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Response envelope returned by the clearbreakpoint command. */
export interface QmlClearBreakpointResponse extends QmlResponse<undefined>
{
    /** Command name echoed by the runtime. */
    command : "clearbreakpoint";
}

/** Check whether a value matches the clearbreakpoint response shape. */
export function isClearSetBreakpointResponse(value : any) : value is QmlClearBreakpointResponse
{
    if (!isQmlResponse(value) ||
        value.command !== "clearbreakpoint")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Backward-compatible alias with a corrected name for clearbreakpoint responses. */
export const isQmlClearBreakpointResponse = isClearSetBreakpointResponse;


// SET EXCEPTION BREAK
///////////////////////////////////////////////////////////////////////

/** Arguments for the setexceptionbreak command. */
export interface QmlSetExceptionBreakArguments
{
    /** Exception break mode. */
    type : string;
    /** Whether the mode is enabled. */
    enabled : boolean;
}

/** Check whether a value matches setexceptionbreak arguments. */
export function isQmlSetExceptionBreakArguments(value : any) : value is QmlSetExceptionBreakArguments
{
    if (typeof value !== "object" ||
        typeof value.type !== "string" ||
        typeof value.enabled !== "boolean")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Request envelope for the setexceptionbreak command. */
export type QmlSetExceptionBreakRequest = QmlRequest<QmlSetExceptionBreakArguments>;

/** Check whether a value matches the setexceptionbreak request shape. */
export function isQmlSetExceptionBreakRequest(value : any) : value is QmlSetExceptionBreakRequest
{
    if (!isQmlRequest(value) ||
        value.command !== "setexceptionbreak" ||
        !isQmlSetExceptionBreakArguments(value.arguments))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Response envelope returned by the setexceptionbreak command. */
export interface QmlSetExceptionBreakResponse extends QmlResponse<QmlSetExceptionBreakArguments>
{
    /** Command name echoed by the runtime. */
    command : "setexceptionbreak";
}

/** Check whether a value matches the setexceptionbreak response shape. */
export function isQmlSetExceptionBreakResponse(value : any) : value is QmlSetExceptionBreakResponse
{
    if (!isQmlResponse(value) ||
        value.command !== "setexceptionbreak" ||
        !isQmlSetExceptionBreakArguments(value.body))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}


// BREAK
///////////////////////////////////////////////////////////////////////

/** Body payload for a break event emitted by the runtime. */
export interface QmlBreakEventBody
{
    /** Breakpoint ids that triggered the pause. */
    breakpoints : number[];
    /** Invocation or binding text shown by the runtime. */
    invocationText : string;
    /** Script metadata attached to the event. */
    script:
    {
        /** Script name or URL. */
        name : string;
    };
    /** 0-based source line that triggered the event. */
    sourceLine : number;
}

/** Check whether a value matches the break-event body shape. */
export function isQmlBreakEventBody(value : any) : value is QmlBreakEventBody
{
    if (typeof value !== "object" ||
        typeof value.invocationText !== "string" ||
        typeof value.script !== "object" ||
        typeof value.script.name !== "string" ||
        typeof value.sourceLine !== "number" ||
        !Array.isArray(value.breakpoints))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    for (const breakpointId of value.breakpoints)
    {
        if (typeof breakpointId !== "number")
            return false;
    }

    return true;
}

/** Break event envelope emitted by the runtime. */
export interface QmlBreakEvent extends QmlEvent<QmlBreakEventBody>
{
    /** Event name emitted by the runtime. */
    event : "break";
}

/** Check whether a value matches the break event shape. */
export function isQmlBreakEvent(value : any) : value is QmlBreakEvent
{
    if (!isQmlEvent(value) ||
        value.event !== "break" ||
        !isQmlBreakEventBody(value.body))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}


// CONTINUE
///////////////////////////////////////////////////////////////////////

/** Arguments for the continue command. */
export interface QmlContinueRequestArguments
{
    /** Optional step action requested by the client. */
    stepaction? : "in" | "out" | "next";
    /** Optional step count. */
    stepcount? : 1 | undefined;
}

/** Check whether a value matches continue arguments. */
export function isQmlContinueRequestArguments(value : any) : value is QmlContinueRequestArguments
{
    if (typeof value !== "object" ||
        (value.stepaction !== undefined && typeof value.stepaction !== "string") ||
        (value.stepcount !== undefined && typeof value.stepcount !== "number"))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Request envelope for the continue command. */
export type QmlContinueRequest = QmlRequest<QmlContinueRequestArguments>;

/** Check whether a value matches the continue request shape. */
export function isQmlContinueRequest(value : any) : value is QmlContinueRequest
{
    if (!isQmlRequest(value) ||
        value.command !== "continue" ||
        !isQmlContinueRequestArguments(value.arguments))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Response envelope returned by the continue command. */
export interface QmlContinueResponse extends QmlResponse<undefined>
{
    /** Command name echoed by the runtime. */
    command : "continue";
}

/** Check whether a value matches the continue response shape. */
export function isQmlContinueResponse(value : any) : value is QmlContinueResponse
{
    if (!isQmlResponse(value) ||
        value.command !== "continue")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}


// BACKTRACE
///////////////////////////////////////////////////////////////////////

/** Arguments for the backtrace command. */
export interface QmlBacktraceArguments
{

}

/** Check whether a value matches backtrace arguments. */
export function isQmlBacktraceArguments(value : any) : value is QmlBacktraceArguments
{
    if (typeof value !== "object")
        return false;

    return true;
}

/** Request envelope for the backtrace command. */
export type QmlBacktraceRequest = QmlRequest<QmlBacktraceArguments>;

/** Check whether a value matches the backtrace request shape. */
export function isQmlBacktraceRequest(value : any) : value is QmlBacktraceRequest
{
    if (!isQmlRequest(value) ||
        value.command !== "backtrace" ||
        !isQmlBacktraceArguments(value.arguments))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Response envelope returned by the backtrace command. */
export interface QmlBacktraceResponse extends QmlResponse<QmlBacktrace>
{
    /** Command name echoed by the runtime. */
    command : "backtrace";
}

/** Check whether a value matches the backtrace response shape. */
export function isQmlBacktraceResponse(value : any) : value is QmlBacktraceResponse
{
    if (!isQmlResponse(value) ||
        value.command !== "backtrace" ||
        !isQmlBacktrace(value.body))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}


// FRAME
///////////////////////////////////////////////////////////////////////

/** Arguments for the frame command. */
export interface QmlFrameRequestArguments
{
    /** Frame index to materialize. */
    number: number;
}

/** Check whether a value matches frame arguments. */
export function isQmlFrameRequestArguments(value : any) : value is QmlFrameRequestArguments
{
    if (typeof value !== "object" ||
        typeof value.number !== "number")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}
/** Request envelope for the frame command. */
export type QmlFrameRequest = QmlRequest<QmlFrameRequestArguments>;

/** Check whether a value matches the frame request shape. */
export function isQmlFrameRequest(value : any) : value is QmlFrameRequest
{
    if (!isQmlRequest(value) ||
        value.command !== "frame" ||
        !isQmlFrameRequestArguments(value.arguments))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Response envelope returned by the frame command. */
export type QmlFrameResponse = QmlResponse<QmlFrame>;

/** Check whether a value matches the frame response shape. */
export function isQmlFrameResponse(value : any) : value is QmlFrameResponse
{
    if (!isQmlResponse(value) ||
        value.command !== "frame" ||
        !isQmlFrame((value as any).body))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}


// SCOPE
///////////////////////////////////////////////////////////////////////

/** Arguments for the scope command. */
export interface QmlScopeRequestArguments
{
    /** Scope index to materialize. */
    number : number;
}

/** Check whether a value matches scope arguments. */
export function isQmlScopeRequestArgument(value : any) : value is QmlScopeRequestArguments
{
    if (typeof value !== "object" ||
        typeof value.number !== "number")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Request envelope for the scope command. */
export type QmlScopeRequest = QmlRequest<QmlScopeRequestArguments>;

/** Check whether a value matches the scope request shape. */
export function isQmlScopeRequest(value : any) : value is QmlScopeRequest
{
    if (!isQmlRequest(value) ||
        value.command !== "scope" ||
        !isQmlScopeRequestArgument(value.arguments))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Response envelope returned by the scope command. */
export type QmlScopeResponse = QmlResponse<QmlScope>;

/** Check whether a value matches the scope response shape. */
export function isQmlScopeResponse(value : any) : value is QmlScopeResponse
{
    if (!isQmlResponse(value) ||
        value.command !== "scope" ||
        !isQmlScope(value.body))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}


// Lookup
///////////////////////////////////////////////////////////////////////

/** Arguments for the lookup command. */
export interface QmlLookupRequestArguments
{
    /** Runtime handles to materialize. */
    handles : number[];
}

/** Check whether a value matches lookup arguments. */
export function isQmlLookupRequestArgument(value : any) : value is QmlLookupRequestArguments
{
    if (typeof value !== "object")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    if (!Array.isArray(value.handles))
        return false;

    for (const element of value.handles)
    {
        if (typeof element !== "number")
            return false;
    }

    return true;
}

/** Request envelope for the lookup command. */
export type QmlLookupRequest = QmlRequest<QmlLookupRequestArguments>;

/** Check whether a value matches the lookup request shape. */
export function isQmlLookupRequest(value : any) : value is QmlLookupRequest
{
    if (!isQmlRequest(value) ||
        value.command !== "lookup" ||
        !isQmlLookupRequestArgument(value.arguments))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Body payload returned by the lookup command. */
export interface QmlLookupBody
{
    [ index: string ] : QmlVariable;
}


/** Response envelope returned by the lookup command. */
export type QmlLookupResponse = QmlResponse<QmlLookupBody>;

/** Check whether a value matches the lookup response shape. */
export function isQmlLookupResponse(value : any) : value is QmlLookupResponse
{
    if (!isQmlResponse(value as any) ||
        value.command !== "lookup" ||
        typeof value.body !== "object")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }


    for (const [ key, variable ] of Object.entries(value.body))
    {
        if (typeof key !== "string")
            return false;

        if (!isQmlVariable(variable))
            return false;
    }

    return true;
}


// EVALUATE
///////////////////////////////////////////////////////////////////////

/** Arguments for the evaluate command. */
export interface QmlEvalutaRequestArguments
{
    /** Frame id used as evaluation context. */
    frame : number;
    /** Expression text to evaluate. */
    expression : string;
}

/** Check whether a value matches evaluate arguments. */
export function isQmlEvalutaRequestArguments(value : any) : value is QmlEvalutaRequestArguments
{
    if (typeof value !== "object" ||
        typeof value.frame !== "number" ||
        typeof value.expression !== "string")
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Backward-compatible alias with a corrected request-argument name. */
export type QmlEvaluateRequestArguments = QmlEvalutaRequestArguments;

/** Request envelope for the evaluate command. */
export type QmlEvalutaRequest = QmlRequest<QmlEvalutaRequestArguments>;

/** Backward-compatible alias with a corrected request type name. */
export type QmlEvaluateRequest = QmlEvalutaRequest;

/** Check whether a value matches the evaluate request shape. */
export function isQmlEvalutaRequest(value : any) : value is QmlEvalutaRequest
{
    if (!isQmlRequest(value) ||
        value.command !== "evaluate" ||
        !isQmlEvalutaRequestArguments(value.arguments))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}

/** Backward-compatible alias with a corrected request-guard name. */
export const isQmlEvaluateRequest = isQmlEvalutaRequest;

/** Response envelope returned by the evaluate command. */
export type QmlEvaluateResponse = QmlResponse<QmlVariable>;

/** Check whether a value matches the evaluate response shape. */
export function isQmlEvaluateResponse(value : any) : value is QmlEvaluateResponse
{
    if (!isQmlResponse(value) ||
        value.command !== "evaluate" ||
        !isQmlVariable(value.body))
    {
        /* eslint-disable */
        return false;
        /* eslint-enable */
    }

    return true;
}
