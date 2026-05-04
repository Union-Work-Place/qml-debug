import assert = require("assert");
import PacketManager from "@qml-debug/packet-manager";
import { QmlDebugSession } from "@qml-debug/debug-adapter";
import { DebugProtocol } from "@vscode/debugprotocol";

/** Successful QML/V8 service response used by DAP tests. */
function qmlResponse(command : string, body : any = undefined) : any
{
    return {
        type: "response",
        seq: 1,
        request_seq: 1,
        command: command,
        success: true,
        running: false,
        body: body
    };
}

/** DAP response shell passed into protected request handlers. */
function dapResponse(command : string) : any
{
    return {
        type: "response",
        seq: 1,
        request_seq: 1,
        command: command,
        success: true
    };
}

/** Mock service with initialize/deinitialize accounting. */
class MockLifecycleService
{
    /** Number of initialize calls. */
    public initializeCount = 0;
    /** Number of deinitialize calls. */
    public deinitializeCount = 0;

    /** Record service initialization. */
    public async initialize() : Promise<void>
    {
        this.initializeCount++;
    }

    /** Record service shutdown. */
    public async deinitialize() : Promise<void>
    {
        this.deinitializeCount++;
    }
}

/** Mock declarative client that records handshakes. */
class MockDeclarativeDebugClient extends MockLifecycleService
{
    /** Number of handshake calls. */
    public handshakeCount = 0;

    /** Record a declarative debug handshake. */
    public async handshake() : Promise<void>
    {
        this.handshakeCount++;
    }
}

/** Mock packet manager that avoids network access. */
class MockPacketManager extends PacketManager
{
    /** Number of transport connect calls. */
    public connectCount = 0;
    /** Number of transport disconnect calls. */
    public disconnectCount = 0;

    /** Create a packet manager with an inert session. */
    public constructor()
    {
        super({} as any);
    }

    /** Record a connection without opening a socket. */
    public async connect() : Promise<void>
    {
        this.connectCount++;
    }

    /** Record a disconnection without closing a socket. */
    public async disconnect() : Promise<void>
    {
        this.disconnectCount++;
    }
}

/** Mock V8 debugger service used to validate DAP-to-QML translation. */
class MockV8Debugger extends MockLifecycleService
{
    /** Number of V8 handshakes. */
    public handshakeCount = 0;
    /** Number of V8 disconnects. */
    public disconnectCount = 0;
    /** Breakpoint set requests. */
    public setBreakpointCalls : Array<{ filename : string; line : number }> = [];
    /** Breakpoint clear requests. */
    public clearBreakpointCalls : number[] = [];
    /** Continue or step requests. */
    public continueCalls : Array<{ stepAction? : "in" | "out" | "next"; stepCount? : 1 }> = [];
    /** Last exception breakpoint request. */
    public exceptionRequest? : { type : string; enabled : boolean };
    /** Stack trace response returned by requestBacktrace. */
    public backtraceResponse = qmlResponse("backtrace", { fromFrame: 0, toFrame: 0, frames: [] });
    /** Frame response returned by requestFrame. */
    public frameResponse = qmlResponse("frame", { index: 0, func: "", script: "", line: 0, debuggerFrame: false, scopes: [] });
    /** Scope response returned by requestScope. */
    public scopeResponse = qmlResponse("scope", { index: 0, type: 0 });
    /** Lookup response returned by requestLookup. */
    public lookupResponse = qmlResponse("lookup", {});
    /** Evaluate response returned by requestEvaluate. */
    public evaluateResponse = qmlResponse("evaluate", { handle: 1, type: "number", value: 42 });

    /** Record V8 debugger handshake. */
    public async handshake() : Promise<void>
    {
        this.handshakeCount++;
    }

    /** Record V8 debugger disconnect. */
    public async disconnect() : Promise<void>
    {
        this.disconnectCount++;
    }

    /** Record a remote breakpoint installation. */
    public async requestSetBreakpoint(filename : string, line : number) : Promise<any>
    {
        this.setBreakpointCalls.push({ filename: filename, line: line });
        return qmlResponse("setbreakpoint", { breakpoint: this.setBreakpointCalls.length * 10, type: "scriptRegExp" });
    }

    /** Record a remote breakpoint removal. */
    public async requestClearBreakpoint(id : number) : Promise<any>
    {
        this.clearBreakpointCalls.push(id);
        return qmlResponse("clearbreakpoint");
    }

    /** Record exception breakpoint state. */
    public async requestSetExceptionBreakpoint(type : string, enabled : boolean) : Promise<any>
    {
        this.exceptionRequest = { type: type, enabled: enabled };
        return qmlResponse("setexceptionbreak", { type: type, enabled: enabled });
    }

    /** Return the configured stack trace response. */
    public async requestBacktrace() : Promise<any>
    {
        return this.backtraceResponse;
    }

    /** Return the configured frame response. */
    public async requestFrame(frameId : number) : Promise<any>
    {
        return this.frameResponse;
    }

    /** Return the configured scope response. */
    public async requestScope(scopeId : number) : Promise<any>
    {
        return this.scopeResponse;
    }

    /** Return the configured lookup response. */
    public async requestLookup(handles : number[]) : Promise<any>
    {
        return this.lookupResponse;
    }

    /** Return the configured evaluate response. */
    public async requestEvaluate(frameId : number, expression : string) : Promise<any>
    {
        return this.evaluateResponse;
    }

    /** Record continue and step requests. */
    public async requestContinue(stepAction? : "in" | "out" | "next", stepCount? : 1) : Promise<any>
    {
        this.continueCalls.push({ stepAction: stepAction, stepCount: stepCount });
        return qmlResponse("continue");
    }
}

/** Testable QML session that exposes protected DAP handlers and captures outbound protocol messages. */
class TestQmlDebugSession extends QmlDebugSession
{
    /** Captured DAP responses. */
    public readonly responses : DebugProtocol.Response[] = [];
    /** Captured DAP events. */
    public readonly events : DebugProtocol.Event[] = [];

    /** Capture a DAP response instead of writing it to stdio. */
    public sendResponse(response : DebugProtocol.Response) : void
    {
        this.responses.push(response);
    }

    /** Capture a DAP event instead of writing it to stdio. */
    public sendEvent(event : DebugProtocol.Event) : void
    {
        this.events.push(event);
    }

    /** Capture a DAP error response instead of writing it to stdio. */
    protected sendErrorResponse(response : DebugProtocol.Response, codeOrMessage : any, format? : string, variables? : any, dest? : any) : void
    {
        response.success = false;
        response.message = typeof codeOrMessage === "object" ? codeOrMessage.format : format;
        this.responses.push(response);
    }

    /** Invoke initializeRequest for tests. */
    public async callInitialize(args : DebugProtocol.InitializeRequestArguments) : Promise<DebugProtocol.InitializeResponse>
    {
        const response = dapResponse("initialize") as DebugProtocol.InitializeResponse;
        await this.initializeRequest(response, args);
        return response;
    }

    /** Invoke attachRequest for tests. */
    public async callAttach(args : any) : Promise<DebugProtocol.AttachResponse>
    {
        const response = dapResponse("attach") as DebugProtocol.AttachResponse;
        await this.attachRequest(response, args);
        return response;
    }

    /** Invoke disconnectRequest for tests. */
    public async callDisconnect() : Promise<DebugProtocol.DisconnectResponse>
    {
        const response = dapResponse("disconnect") as DebugProtocol.DisconnectResponse;
        await this.disconnectRequest(response, {});
        return response;
    }

    /** Invoke setBreakPointsRequest for tests. */
    public async callSetBreakpoints(args : DebugProtocol.SetBreakpointsArguments) : Promise<DebugProtocol.SetBreakpointsResponse>
    {
        const response = dapResponse("setBreakpoints") as DebugProtocol.SetBreakpointsResponse;
        await this.setBreakPointsRequest(response, args);
        return response;
    }

    /** Invoke setExceptionBreakPointsRequest for tests. */
    public async callSetExceptionBreakpoints(filters : string[]) : Promise<DebugProtocol.SetExceptionBreakpointsResponse>
    {
        const response = dapResponse("setExceptionBreakpoints") as DebugProtocol.SetExceptionBreakpointsResponse;
        await this.setExceptionBreakPointsRequest(response, { filters: filters });
        return response;
    }

    /** Invoke stackTraceRequest for tests. */
    public async callStackTrace(args : DebugProtocol.StackTraceArguments) : Promise<DebugProtocol.StackTraceResponse>
    {
        const response = dapResponse("stackTrace") as DebugProtocol.StackTraceResponse;
        await this.stackTraceRequest(response, args);
        return response;
    }

    /** Invoke scopesRequest for tests. */
    public async callScopes(frameId : number) : Promise<DebugProtocol.ScopesResponse>
    {
        const response = dapResponse("scopes") as DebugProtocol.ScopesResponse;
        await this.scopesRequest(response, { frameId: frameId });
        return response;
    }

    /** Invoke variablesRequest for tests. */
    public async callVariables(args : DebugProtocol.VariablesArguments) : Promise<DebugProtocol.VariablesResponse>
    {
        const response = dapResponse("variables") as DebugProtocol.VariablesResponse;
        await this.variablesRequest(response, args);
        return response;
    }

    /** Invoke evaluateRequest for tests. */
    public async callEvaluate(args : DebugProtocol.EvaluateArguments) : Promise<DebugProtocol.EvaluateResponse>
    {
        const response = dapResponse("evaluate") as DebugProtocol.EvaluateResponse;
        await this.evaluateRequest(response, args);
        return response;
    }

    /** Invoke a stepping request for tests. */
    public async callStep(kind : "in" | "out" | "next" | "continue") : Promise<DebugProtocol.Response>
    {
        const response = dapResponse(kind);
        if (kind === "in")
            await this.stepInRequest(response as DebugProtocol.StepInResponse, { threadId: this.mainQmlThreadId });
        else if (kind === "out")
            await this.stepOutRequest(response as DebugProtocol.StepOutResponse, { threadId: this.mainQmlThreadId });
        else if (kind === "next")
            await this.nextRequest(response as DebugProtocol.NextResponse, { threadId: this.mainQmlThreadId });
        else
            await this.continueRequest(response as DebugProtocol.ContinueResponse, { threadId: this.mainQmlThreadId });

        return response;
    }
}

/** Create a QML debug session with mocked service dependencies. */
function createSession() : { session : TestQmlDebugSession; packetManager : MockPacketManager; v8 : MockV8Debugger; declarative : MockDeclarativeDebugClient }
{
    const packetManager = new MockPacketManager();
    const v8 = new MockV8Debugger();
    const declarative = new MockDeclarativeDebugClient();
    const session = new TestQmlDebugSession({} as any,
        {
            packetManager: packetManager,
            qmlDebugger: new MockLifecycleService(),
            debugMessages: new MockLifecycleService(),
            v8debugger: v8,
            declarativeDebugClient: declarative
        } as any
    );

    return { session: session, packetManager: packetManager, v8: v8, declarative: declarative };
}

describe("QmlDebugSession", () =>
{
    it("reports modern DAP capabilities on initialize", async () =>
    {
        const { session } = createSession();

        const response = await session.callInitialize({ adapterID: "qml", linesStartAt1: true, columnsStartAt1: true });

        assert.strictEqual(response.body!.supportsConfigurationDoneRequest, true);
        assert.strictEqual(response.body!.supportsFunctionBreakpoints, false);
        assert.strictEqual(response.body!.exceptionBreakpointFilters![0].filter, "all");
    });

    it("normalizes physical and qrc source path mappings", () =>
    {
        const { session } = createSession();

        session.setPathMappings({ "qrc:/app/qml": "/workspace/app/qml", "qrc:/app/qml/components": "/workspace/app/qml/components" });

        assert.strictEqual(session.mapPathTo("/workspace/app/qml/components/Button.qml"), "qrc:/app/qml/components/Button.qml");
        assert.strictEqual(session.mapPathFrom("qrc:/app/qml/components/Button.qml"), "/workspace/app/qml/components/Button.qml");
        assert.strictEqual(session.mapPathTo("/other/Main.qml"), "Main.qml");
    });

    it("keeps breakpoints pending before attach and synchronizes them after attach", async () =>
    {
        const { session, v8 } = createSession();
        session.setPathMappings({ "qrc:/qml": "/project/qml" });

        const pending = await session.callSetBreakpoints({ source: { path: "/project/qml/Main.qml" }, breakpoints: [ { line: 5 } ] });
        assert.strictEqual(pending.body!.breakpoints[0].verified, false);
        assert.strictEqual(v8.setBreakpointCalls.length, 0);

        await session.callAttach({ host: "localhost", port: 12150, paths: { "qrc:/qml": "/project/qml" } });

        assert.deepStrictEqual(v8.setBreakpointCalls, [ { filename: "qrc:/qml/Main.qml", line: 4 } ]);
    });

    it("sets and clears remote breakpoints after attach", async () =>
    {
        const { session, v8 } = createSession();
        await session.callAttach({ host: "localhost", port: 12150, paths: { "qrc:/qml": "/project/qml" } });

        const setResponse = await session.callSetBreakpoints({ source: { path: "/project/qml/Main.qml" }, breakpoints: [ { line: 7 } ] });
        assert.strictEqual(setResponse.body!.breakpoints[0].verified, true);
        assert.deepStrictEqual(v8.setBreakpointCalls[0], { filename: "qrc:/qml/Main.qml", line: 6 });

        await session.callSetBreakpoints({ source: { path: "/project/qml/Main.qml" }, breakpoints: [] });

        assert.deepStrictEqual(v8.clearBreakpointCalls, [ 10 ]);
    });

    it("maps stack traces, scopes, variables and evaluate results to DAP", async () =>
    {
        const { session, v8 } = createSession();
        session.setPathMappings({ "qrc:/qml": "/project/qml" });
        v8.backtraceResponse = qmlResponse("backtrace", { fromFrame: 0, toFrame: 1, frames: [ { index: 3, func: "clicked", script: "qrc:/qml/Main.qml", line: 8, debuggerFrame: false, scopes: [] } ] });
        v8.frameResponse = qmlResponse("frame", { index: 3, func: "clicked", script: "qrc:/qml/Main.qml", line: 8, debuggerFrame: false, scopes: [ { frameIndex: 3, index: 2, type: 2 } ] });
        v8.scopeResponse = qmlResponse("scope", { frameIndex: 3, index: 2, type: 2, object: { handle: 4, type: "object", value: 3 } });
        v8.lookupResponse = qmlResponse("lookup", { "4": { handle: 4, type: "object", value: 3, properties: [ { name: "z", type: "string", value: "last" }, { name: "handler", type: "function", value: "fn" }, { name: "a", type: "object", value: 1, ref: 9 } ] } });
        v8.evaluateResponse = qmlResponse("evaluate", { handle: 9, type: "string", value: "hello" });

        const stack = await session.callStackTrace({ threadId: session.mainQmlThreadId });
        assert.strictEqual(stack.body!.stackFrames[0].source!.path, "/project/qml/Main.qml");
        assert.strictEqual(stack.body!.stackFrames[0].line, 9);

        const scopes = await session.callScopes(3);
        assert.strictEqual(scopes.body!.scopes[0].name, "Locals");
        assert.strictEqual(scopes.body!.scopes[0].variablesReference, 5);

        const variables = await session.callVariables({ variablesReference: 5 });
        assert.deepStrictEqual(variables.body!.variables.map((variable) => variable.name), [ "a", "z" ]);
        assert.strictEqual(variables.body!.variables[0].variablesReference, 10);

        const evaluate = await session.callEvaluate({ expression: "title", frameId: 3, context: "watch" });
        assert.strictEqual(evaluate.body!.result, "\"hello\"");
    });

    it("routes stepping, exception and disconnect requests to mocked services", async () =>
    {
        const { session, packetManager, v8, declarative } = createSession();

        await session.callSetExceptionBreakpoints([ "all" ]);
        await session.callStep("in");
        await session.callStep("next");
        await session.callStep("out");
        await session.callStep("continue");
        await session.callAttach({ host: "localhost", port: 12150, paths: {} });
        await session.callDisconnect();

        assert.deepStrictEqual(v8.exceptionRequest, { type: "all", enabled: true });
        assert.deepStrictEqual(v8.continueCalls.slice(0, 4), [ { stepAction: "in", stepCount: 1 }, { stepAction: "next", stepCount: 1 }, { stepAction: "out", stepCount: 1 }, { stepAction: undefined, stepCount: undefined } ]);
        assert.strictEqual(packetManager.connectCount, 1);
        assert.strictEqual(packetManager.disconnectCount, 1);
        assert.strictEqual(declarative.handshakeCount, 1);
        assert.strictEqual(v8.disconnectCount, 1);
    });
});
