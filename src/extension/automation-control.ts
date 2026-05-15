import * as vscode from "vscode";

/** Stable schema version exposed to machine-facing clients. */
export const QML_AUTOMATION_SCHEMA_VERSION = 1;

/** Error codes returned by the automation control plane. */
export type QmlAutomationErrorCode =
    "InvalidArguments"
    | "NoQmlSession"
    | "RequestFailed"
    | "SessionNotFound"
    | "UnsupportedAction";

/** Request accepted by `qml-debug.automation.run`. */
export interface QmlAutomationRunRequest
{
    /** Stable action name such as `dap.evaluate` or `profiler.export`. */
    action : string;
    /** Optional QML debug session id. If omitted, the active or first live QML session is used. */
    sessionId? : string;
    /** Action-specific arguments. */
    args? : any;
}

/** Successful automation response. */
export interface QmlAutomationSuccessResponse
{
    /** Always true for successful responses. */
    ok : true;
    /** Schema version used by this response. */
    schemaVersion : number;
    /** Action that produced this response. */
    action : string;
    /** Session id used by session-bound actions. */
    sessionId? : string;
    /** Action-specific result payload. */
    body : any;
}

/** Failed automation response with deterministic error details. */
export interface QmlAutomationErrorResponse
{
    /** Always false for failed responses. */
    ok : false;
    /** Schema version used by this response. */
    schemaVersion : number;
    /** Action that failed, when it could be determined. */
    action? : string;
    /** Requested session id, when one was provided. */
    sessionId? : string;
    /** Stable error payload for automation clients. */
    error : {
        code : QmlAutomationErrorCode;
        message : string;
        details? : any;
    };
}

/** Automation command result. */
export type QmlAutomationResponse = QmlAutomationSuccessResponse | QmlAutomationErrorResponse;

/** Breakpoint value accepted by `breakpoints.setSource`. */
export interface QmlAutomationSourceBreakpoint
{
    /** One-based source line. */
    line : number;
    /** Optional one-based source column. */
    column? : number;
    /** Optional conditional expression. */
    condition? : string;
    /** Optional hit-count expression. */
    hitCondition? : string;
    /** Optional logpoint message. */
    logMessage? : string;
}

/** Environment boundary used by tests and the real VS Code extension host. */
export interface QmlAutomationEnvironment
{
    /** Return the currently focused debug session. */
    getActiveDebugSession() : vscode.DebugSession | undefined;
    /** Return all live debug sessions known to VS Code. */
    getDebugSessions() : readonly vscode.DebugSession[];
    /** Start a VS Code debug session from a launch/attach configuration. */
    startDebugging(folder : vscode.WorkspaceFolder | undefined, configuration : vscode.DebugConfiguration) : Thenable<boolean>;
    /** Stop one debug session or all sessions when omitted. */
    stopDebugging(session? : vscode.DebugSession) : Thenable<void>;
    /** Replace or append source breakpoints and return a serializable summary. */
    setSourceBreakpoints(sourcePath : string, breakpoints : QmlAutomationSourceBreakpoint[], replace : boolean) : Promise<any>;
}

/** Description for one stable automation action. */
interface QmlAutomationActionDescription
{
    /** Stable action name. */
    action : string;
    /** Whether a live QML debug session is required. */
    sessionRequired : boolean;
    /** Short machine-readable summary. */
    description : string;
    /** Names of required argument fields. */
    requiredArgs : string[];
}

const ACTIONS : QmlAutomationActionDescription[] = [
    { action: "sessions", sessionRequired: false, description: "List live QML debug sessions and the preferred session id.", requiredArgs: [] },
    { action: "debug.launch", sessionRequired: false, description: "Start a QML launch session from a debug configuration.", requiredArgs: [ "configuration" ] },
    { action: "debug.attach", sessionRequired: false, description: "Start a QML attach session from a debug configuration.", requiredArgs: [ "configuration" ] },
    { action: "debug.stop", sessionRequired: false, description: "Stop one QML session or all QML sessions.", requiredArgs: [] },
    { action: "breakpoints.setSource", sessionRequired: false, description: "Replace or append breakpoints for one source path.", requiredArgs: [ "path", "breakpoints" ] },
    { action: "runtime.capabilities", sessionRequired: true, description: "Return negotiated Qt debug service capabilities.", requiredArgs: [] },
    { action: "dap.stackTrace", sessionRequired: true, description: "Run the DAP stackTrace request.", requiredArgs: [ "threadId" ] },
    { action: "dap.scopes", sessionRequired: true, description: "Run the DAP scopes request.", requiredArgs: [ "frameId" ] },
    { action: "dap.variables", sessionRequired: true, description: "Run the DAP variables request.", requiredArgs: [ "variablesReference" ] },
    { action: "dap.evaluate", sessionRequired: true, description: "Evaluate an expression in the active QML runtime.", requiredArgs: [ "expression" ] },
    { action: "dap.pause", sessionRequired: true, description: "Pause the QML runtime.", requiredArgs: [ "threadId" ] },
    { action: "dap.continue", sessionRequired: true, description: "Continue the QML runtime.", requiredArgs: [ "threadId" ] },
    { action: "dap.next", sessionRequired: true, description: "Step over in the QML runtime.", requiredArgs: [ "threadId" ] },
    { action: "dap.stepIn", sessionRequired: true, description: "Step into in the QML runtime.", requiredArgs: [ "threadId" ] },
    { action: "dap.stepOut", sessionRequired: true, description: "Step out in the QML runtime.", requiredArgs: [ "threadId" ] },
    { action: "inspector.status", sessionRequired: true, description: "Return inspector availability and state.", requiredArgs: [] },
    { action: "inspector.setEnabled", sessionRequired: true, description: "Enable or disable interactive inspector selection.", requiredArgs: [ "enabled" ] },
    { action: "inspector.setShowAppOnTop", sessionRequired: true, description: "Toggle target app-on-top inspector mode.", requiredArgs: [ "showAppOnTop" ] },
    { action: "inspector.selectObjects", sessionRequired: true, description: "Select runtime object ids in the Qt inspector.", requiredArgs: [ "objectIds" ] },
    { action: "inspector.selectBySource", sessionRequired: true, description: "Resolve and select QML objects at a source location.", requiredArgs: [ "path", "line", "column" ] },
    { action: "inspector.objectTree", sessionRequired: true, description: "Return decoded object-tree metadata for selected object ids.", requiredArgs: [] },
    { action: "profiler.status", sessionRequired: true, description: "Return profiler capture state.", requiredArgs: [] },
    { action: "profiler.start", sessionRequired: true, description: "Start profiler capture.", requiredArgs: [] },
    { action: "profiler.stop", sessionRequired: true, description: "Stop profiler capture.", requiredArgs: [] },
    { action: "profiler.clear", sessionRequired: true, description: "Clear captured profiler data.", requiredArgs: [] },
    { action: "profiler.export", sessionRequired: true, description: "Export the structured profiler snapshot.", requiredArgs: [] }
];

const SESSION_REQUESTS : { [action : string] : string } = {
    "runtime.capabilities": "qml/getCapabilities",
    "dap.stackTrace": "stackTrace",
    "dap.scopes": "scopes",
    "dap.variables": "variables",
    "dap.evaluate": "evaluate",
    "dap.pause": "pause",
    "dap.continue": "continue",
    "dap.next": "next",
    "dap.stepIn": "stepIn",
    "dap.stepOut": "stepOut",
    "inspector.status": "qml/inspector/status",
    "inspector.setEnabled": "qml/inspector/setEnabled",
    "inspector.setShowAppOnTop": "qml/inspector/setShowAppOnTop",
    "inspector.selectObjects": "qml/inspector/selectObjects",
    "inspector.selectBySource": "qml/inspector/selectBySource",
    "inspector.objectTree": "qml/inspector/objectTree",
    "profiler.status": "qml/profiler/status",
    "profiler.start": "qml/profiler/start",
    "profiler.stop": "qml/profiler/stop",
    "profiler.clear": "qml/profiler/clear",
    "profiler.export": "qml/profiler/export"
};

/** Return the stable action/schema description consumed by automation clients. */
export function describeAutomationControl() : { schemaVersion : number; actions : QmlAutomationActionDescription[]; errors : QmlAutomationErrorCode[] }
{
    return {
        schemaVersion: QML_AUTOMATION_SCHEMA_VERSION,
        actions: ACTIONS,
        errors: [ "InvalidArguments", "NoQmlSession", "RequestFailed", "SessionNotFound", "UnsupportedAction" ]
    };
}

/** Convert command arguments into the stable request envelope. */
export function coerceAutomationRunRequest(requestOrAction : QmlAutomationRunRequest | string, args? : any) : QmlAutomationRunRequest
{
    if (typeof requestOrAction === "string")
        return { action: requestOrAction, args: args };

    return requestOrAction;
}

/** Machine-facing controller that bridges stable actions to VS Code debug sessions. */
export class QmlAutomationController
{
    /** Create a controller bound to a concrete VS Code environment. */
    public constructor(private readonly environment : QmlAutomationEnvironment)
    {
    }

    /** Execute one stable automation request and always return a serializable result. */
    public async run(request : QmlAutomationRunRequest) : Promise<QmlAutomationResponse>
    {
        const action = request?.action;
        const args = request?.args ?? {};

        if (typeof action !== "string" || action.length === 0)
            return this.failure(undefined, request?.sessionId, "InvalidArguments", "Automation request requires a non-empty action string.");

        try
        {
            if (action === "sessions")
                return this.success(action, undefined, this.getSessionsResponse());

            if (action === "debug.launch" || action === "debug.attach")
                return await this.startDebugging(action, args);

            if (action === "debug.stop")
                return await this.stopDebugging(action, request.sessionId);

            if (action === "breakpoints.setSource")
                return await this.setSourceBreakpoints(action, args);

            const debugRequest = SESSION_REQUESTS[action];
            if (debugRequest === undefined)
                return this.failure(action, request.sessionId, "UnsupportedAction", "Unsupported QML automation action: " + action + ".");

            return await this.runSessionRequest(action, request.sessionId, debugRequest, args);
        }
        catch (error)
        {
            if (error instanceof AutomationError)
                return this.failure(action, request.sessionId, error.code, error.message, error.details);

            return this.failure(action, request.sessionId, "RequestFailed", String(error));
        }
    }

    /** Return serializable live QML session metadata. */
    private getSessionsResponse() : { activeSessionId? : string; preferredSessionId? : string; sessions : { id : string; name : string; type : string; active : boolean }[] }
    {
        const activeSession = this.environment.getActiveDebugSession();
        const qmlSessions = this.environment.getDebugSessions().filter((session) : boolean => { return session.type === "qml"; });
        const preferredSession = this.selectSession(undefined, false);

        return {
            activeSessionId: activeSession?.id,
            preferredSessionId: preferredSession?.id,
            sessions: qmlSessions.map((session) =>
            {
                return {
                    id: session.id,
                    name: session.name,
                    type: session.type,
                    active: session.id === activeSession?.id
                };
            })
        };
    }

    /** Start a launch or attach session from a provided debug configuration. */
    private async startDebugging(action : string, args : any) : Promise<QmlAutomationResponse>
    {
        const configuration = this.requireConfiguration(args);
        configuration.type = "qml";
        configuration.request = action === "debug.launch" ? "launch" : "attach";

        const started = await this.environment.startDebugging(undefined, configuration);
        return this.success(action, undefined,
            {
                started: started,
                name: configuration.name,
                request: configuration.request,
                type: configuration.type
            }
        );
    }

    /** Stop one selected QML session or all QML sessions. */
    private async stopDebugging(action : string, sessionId : string | undefined) : Promise<QmlAutomationResponse>
    {
        if (sessionId !== undefined)
        {
            const session = this.selectSession(sessionId, true);
            await this.environment.stopDebugging(session);
            return this.success(action, session.id, { stoppedSessionIds: [ session.id ] });
        }

        const qmlSessions = this.environment.getDebugSessions().filter((session) : boolean => { return session.type === "qml"; });
        for (const session of qmlSessions)
            await this.environment.stopDebugging(session);

        return this.success(action, undefined, { stoppedSessionIds: qmlSessions.map((session) : string => { return session.id; }) });
    }

    /** Apply source breakpoints through VS Code's breakpoint model. */
    private async setSourceBreakpoints(action : string, args : any) : Promise<QmlAutomationResponse>
    {
        if (typeof args?.path !== "string" || args.path.length === 0)
            throw new AutomationError("InvalidArguments", "breakpoints.setSource requires args.path.");

        if (!Array.isArray(args.breakpoints))
            throw new AutomationError("InvalidArguments", "breakpoints.setSource requires args.breakpoints.");

        const breakpoints = args.breakpoints.map((breakpoint : any) : QmlAutomationSourceBreakpoint =>
        {
            if (typeof breakpoint?.line !== "number" || !Number.isFinite(breakpoint.line) || breakpoint.line < 1)
                throw new AutomationError("InvalidArguments", "Each source breakpoint requires a one-based positive line number.", breakpoint);

            return {
                line: Math.trunc(breakpoint.line),
                column: typeof breakpoint.column === "number" && Number.isFinite(breakpoint.column) ? Math.max(1, Math.trunc(breakpoint.column)) : undefined,
                condition: typeof breakpoint.condition === "string" ? breakpoint.condition : undefined,
                hitCondition: typeof breakpoint.hitCondition === "string" ? breakpoint.hitCondition : undefined,
                logMessage: typeof breakpoint.logMessage === "string" ? breakpoint.logMessage : undefined
            };
        });

        const body = await this.environment.setSourceBreakpoints(args.path, breakpoints, args.replace !== false);
        return this.success(action, undefined, body);
    }

    /** Execute one DAP or QML custom request against a selected session. */
    private async runSessionRequest(action : string, sessionId : string | undefined, debugRequest : string, args : any) : Promise<QmlAutomationResponse>
    {
        const session = this.selectSession(sessionId, true);
        const body = await session.customRequest(debugRequest, args);
        return this.success(action, session.id, body);
    }

    /** Select a QML debug session, optionally throwing when none is available. */
    private selectSession(sessionId : string | undefined, required : true) : vscode.DebugSession;
    private selectSession(sessionId : string | undefined, required : false) : vscode.DebugSession | undefined;
    private selectSession(sessionId : string | undefined, required : boolean) : vscode.DebugSession | undefined
    {
        const qmlSessions = this.environment.getDebugSessions().filter((session) : boolean => { return session.type === "qml"; });

        if (sessionId !== undefined)
        {
            const session = qmlSessions.find((candidate) : boolean => { return candidate.id === sessionId; });
            if (session !== undefined)
                return session;

            throw new AutomationError("SessionNotFound", "QML debug session not found: " + sessionId + ".");
        }

        const activeSession = this.environment.getActiveDebugSession();
        if (activeSession?.type === "qml")
            return activeSession;

        const fallbackSession = qmlSessions[0];
        if (fallbackSession !== undefined || !required)
            return fallbackSession;

        throw new AutomationError("NoQmlSession", "No live QML debug session is available for automation request.");
    }

    /** Validate and clone a launch or attach configuration. */
    private requireConfiguration(args : any) : vscode.DebugConfiguration
    {
        const configuration = args?.configuration ?? args;
        if (configuration === null || typeof configuration !== "object" || Array.isArray(configuration))
            throw new AutomationError("InvalidArguments", "debug.launch and debug.attach require args.configuration.");

        if (typeof configuration.name !== "string" || configuration.name.length === 0)
            throw new AutomationError("InvalidArguments", "Debug configuration requires a non-empty name.");

        return { ...configuration } as vscode.DebugConfiguration;
    }

    /** Build a success response. */
    private success(action : string, sessionId : string | undefined, body : any) : QmlAutomationSuccessResponse
    {
        return {
            ok: true,
            schemaVersion: QML_AUTOMATION_SCHEMA_VERSION,
            action: action,
            sessionId: sessionId,
            body: body
        };
    }

    /** Build a deterministic failure response. */
    private failure(action : string | undefined, sessionId : string | undefined, code : QmlAutomationErrorCode, message : string, details? : any) : QmlAutomationErrorResponse
    {
        return {
            ok: false,
            schemaVersion: QML_AUTOMATION_SCHEMA_VERSION,
            action: action,
            sessionId: sessionId,
            error: {
                code: code,
                message: message,
                details: details
            }
        };
    }
}

/** Tracks live QML debug sessions for automation clients. */
export class QmlAutomationSessionRegistry
{
    /** Live QML sessions keyed by session id. */
    private readonly sessions = new Map<string, vscode.DebugSession>();

    /** Register a session that has started or become active. */
    public onSessionStarted(session : vscode.DebugSession) : void
    {
        if (session.type === "qml")
            this.sessions.set(session.id, session);
    }

    /** Remove a terminated session. */
    public onSessionTerminated(session : vscode.DebugSession) : void
    {
        this.sessions.delete(session.id);
    }

    /** Return live QML sessions. */
    public getSessions() : readonly vscode.DebugSession[]
    {
        return Array.from(this.sessions.values());
    }
}

/** Register automation commands for MCP servers and other machine clients. */
export function registerAutomationControl(context : vscode.ExtensionContext) : void
{
    const registry = new QmlAutomationSessionRegistry();
    if (vscode.debug.activeDebugSession !== undefined)
        registry.onSessionStarted(vscode.debug.activeDebugSession);

    const controller = new QmlAutomationController(createDefaultAutomationEnvironment(registry));

    context.subscriptions.push(
        vscode.debug.onDidStartDebugSession((session : vscode.DebugSession) : void => { registry.onSessionStarted(session); }),
        vscode.debug.onDidTerminateDebugSession((session : vscode.DebugSession) : void => { registry.onSessionTerminated(session); }),
        vscode.debug.onDidChangeActiveDebugSession((session : vscode.DebugSession | undefined) : void =>
        {
            if (session !== undefined)
                registry.onSessionStarted(session);
        }),
        vscode.commands.registerCommand("qml-debug.automation.describe", () : ReturnType<typeof describeAutomationControl> => describeAutomationControl()),
        vscode.commands.registerCommand("qml-debug.automation.sessions", () : Promise<QmlAutomationResponse> => controller.run({ action: "sessions" })),
        vscode.commands.registerCommand("qml-debug.automation.run", (requestOrAction : QmlAutomationRunRequest | string, args? : any) : Promise<QmlAutomationResponse> =>
        {
            return controller.run(coerceAutomationRunRequest(requestOrAction, args));
        })
    );
}

/** Build the real VS Code environment boundary. */
function createDefaultAutomationEnvironment(registry : QmlAutomationSessionRegistry) : QmlAutomationEnvironment
{
    return {
        getActiveDebugSession: () : vscode.DebugSession | undefined => vscode.debug.activeDebugSession,
        getDebugSessions: () : readonly vscode.DebugSession[] => registry.getSessions(),
        startDebugging: (folder : vscode.WorkspaceFolder | undefined, configuration : vscode.DebugConfiguration) : Thenable<boolean> => vscode.debug.startDebugging(folder, configuration),
        stopDebugging: (session? : vscode.DebugSession) : Thenable<void> => vscode.debug.stopDebugging(session),
        setSourceBreakpoints: async (sourcePath : string, breakpoints : QmlAutomationSourceBreakpoint[], replace : boolean) : Promise<any> =>
        {
            const uri = vscode.Uri.file(sourcePath);
            if (replace)
            {
                const existing = vscode.debug.breakpoints.filter((breakpoint) : boolean =>
                {
                    return breakpoint instanceof vscode.SourceBreakpoint && breakpoint.location.uri.toString() === uri.toString();
                });
                vscode.debug.removeBreakpoints(existing);
            }

            const created = breakpoints.map((breakpoint) : vscode.SourceBreakpoint =>
            {
                const position = new vscode.Position(breakpoint.line - 1, (breakpoint.column ?? 1) - 1);
                return new vscode.SourceBreakpoint(new vscode.Location(uri, position), true, breakpoint.condition, breakpoint.hitCondition, breakpoint.logMessage);
            });
            vscode.debug.addBreakpoints(created);

            return {
                path: sourcePath,
                replaced: replace,
                breakpoints: created.map((breakpoint) =>
                {
                    return {
                        line: breakpoint.location.range.start.line + 1,
                        column: breakpoint.location.range.start.character + 1,
                        enabled: breakpoint.enabled,
                        condition: breakpoint.condition,
                        hitCondition: breakpoint.hitCondition,
                        logMessage: breakpoint.logMessage
                    };
                })
            };
        }
    };
}

/** Internal typed error used before converting to a serializable response. */
class AutomationError extends Error
{
    /** Create an automation error. */
    public constructor(public readonly code : QmlAutomationErrorCode, message : string, public readonly details? : any)
    {
        super(message);
    }
}