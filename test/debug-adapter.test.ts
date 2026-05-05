import assert = require("assert");
import PacketManager from "@qml-debug/packet-manager";
import { QmlDebugSession } from "@qml-debug/debug-adapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import { EventEmitter } from "events";

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
    /** Negotiated Qt service capabilities surfaced to the adapter. */
    public capabilities = {
        protocolVersion: 1,
        dataStreamVersion: 12,
        services: [
            { name: "DebugMessages", version: 1 },
            { name: "QmlDebugger", version: 1 },
            { name: "V8Debugger", version: 1 },
            { name: "QmlInspector", version: 1 },
            { name: "CanvasFrameRate", version: 1 },
            { name: "EngineControl", version: 1 }
        ]
    };

    /** Record a declarative debug handshake. */
    public async handshake() : Promise<void>
    {
        this.handshakeCount++;
    }

    /** Return the mocked capability snapshot. */
    public getCapabilities() : any
    {
        return this.capabilities;
    }

    /** Return true when the mocked service is present. */
    public isServiceAvailable(name : string) : boolean
    {
        return this.capabilities.services.some((service : { name : string }) : boolean => { return service.name === name; });
    }
}

/** Mock QmlDebugger service used for inspector source lookups. */
class MockQmlDebugger extends MockLifecycleService
{
    /** Recorded source lookup requests. */
    public objectLookupCalls : { filename : string; lineNumber : number; columnNumber : number }[] = [];
    /** Recorded metadata tree requests. */
    public objectTreeCalls : number[][] = [];

    /** Return a deterministic object selection for tests. */
    public async requestObjectsForLocation(filename : string, lineNumber : number, columnNumber : number) : Promise<any[]>
    {
        this.objectLookupCalls.push({ filename: filename, lineNumber: lineNumber, columnNumber: columnNumber });
        return [ { debugId: 41 }, { debugId: 42 } ];
    }

    /** Return a deterministic metadata snapshot for selected objects. */
    public async requestObjectTreeSnapshot(objectIds : number[]) : Promise<any>
    {
        this.objectTreeCalls.push([ ...objectIds ]);
        return {
            selectedObjectIds: [ ...objectIds ],
            objects: [
                {
                    debugId: objectIds[0] ?? 41,
                    className: "QQuickRectangle",
                    idString: "rootRect",
                    name: "Rectangle",
                    source: {
                        url: "Main.qml",
                        lineNumber: 12,
                        columnNumber: 3
                    },
                    contextDebugId: 7,
                    parentDebugId: -1,
                    propertyCount: 1,
                    properties: [
                        {
                            typeId: 10,
                            name: "color",
                            rawValue: "00000008",
                            valueTypeName: "QString",
                            valueContents: "red",
                            hasNotifySignal: true,
                            decodedValue: "red"
                        }
                    ],
                    children: []
                }
            ],
            contexts: [
                {
                    debugId: 7,
                    objectIds: [ objectIds[0] ?? 41 ]
                }
            ]
        };
    }
}

/** Mock inspector service used by custom request tests. */
class MockInspector extends MockLifecycleService
{
    /** Captured enabled state. */
    public enabled = false;
    /** Captured app-on-top state. */
    public showAppOnTop = false;
    /** Last selected object ids. */
    public currentObjectIds : number[] = [];

    /** Return the current mock snapshot. */
    public getSnapshot() : any
    {
        return {
            enabled: this.enabled,
            showAppOnTop: this.showAppOnTop,
            currentObjectIds: [ ...this.currentObjectIds ],
            pendingRequestCount: 0
        };
    }

    /** Update enabled state. */
    public async setInspectToolEnabled(enabled : boolean) : Promise<any>
    {
        this.enabled = enabled;
        if (!enabled)
            this.currentObjectIds = [];
        return this.getSnapshot();
    }

    /** Update app-on-top state. */
    public async setShowAppOnTop(showAppOnTop : boolean) : Promise<any>
    {
        this.showAppOnTop = showAppOnTop;
        return this.getSnapshot();
    }

    /** Record selected object ids. */
    public async selectObjects(objectIds : number[]) : Promise<any>
    {
        this.currentObjectIds = [ ...objectIds ];
        return this.getSnapshot();
    }
}

/** Mock profiler service used by custom request tests. */
class MockProfiler extends MockLifecycleService
{
    /** Whether recording is active. */
    public recording = false;
    /** Requested feature mask. */
    public requestedFeatureMask = "0";
    /** Flush interval in ms. */
    public flushInterval = 250;

    /** Return the current snapshot. */
    public getSnapshot() : any
    {
        return {
            recording: this.recording,
            requestedFeatureMask: this.requestedFeatureMask,
            requestedFeatures: [ "Scene Graph" ],
            flushInterval: this.flushInterval,
            packetCount: 1,
            receivedBytes: 8,
            recentPackets: [ { timestamp: "2026-05-05T20:00:00.000Z", size: 8, kind: "uint64", hexPreview: "0000000000000008" } ],
            timelineEvents: [ { timestamp: "2026-05-05T20:00:00.000Z", size: 8, kind: "uint64", hexPreview: "0000000000000008", decodedValue: 8 } ]
        };
    }

    /** Return a structured export. */
    public exportSnapshot() : any
    {
        return {
            summary: this.getSnapshot(),
            eventKinds: [ { kind: "uint64", count: 1 } ],
            timeline: this.getSnapshot().timelineEvents
        };
    }

    /** Start recording. */
    public async startRecording(featureMask : bigint, flushInterval : number) : Promise<any>
    {
        this.recording = true;
        this.requestedFeatureMask = featureMask.toString();
        this.flushInterval = flushInterval;
        return this.getSnapshot();
    }

    /** Stop recording. */
    public async stopRecording() : Promise<any>
    {
        this.recording = false;
        return this.getSnapshot();
    }

    /** Clear the snapshot. */
    public clear() : any
    {
        return this.getSnapshot();
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
    public setBreakpointCalls : { filename : string; line : number }[] = [];
    /** Breakpoint clear requests. */
    public clearBreakpointCalls : number[] = [];
    /** Continue or step requests. */
    public continueCalls : { stepAction? : "in" | "out" | "next"; stepCount? : 1 }[] = [];
    /** Last exception breakpoint request. */
    public exceptionRequest? : { type : string; enabled : boolean };
    /** All exception breakpoint requests. */
    public exceptionRequests : { type : string; enabled : boolean }[] = [];
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
        this.exceptionRequests.push(this.exceptionRequest);
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

    /** Record a pause request. */
    public async requestPause() : Promise<any>
    {
        return qmlResponse("suspend");
    }
}

/** Minimal child process stub returned by launch-mode tests. */
class MockChildProcess extends EventEmitter
{
    /** Whether kill has been called. */
    public killed = false;

    /** Mark the process as killed. */
    public kill() : boolean
    {
        this.killed = true;
        return true;
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

    /** Invoke a custom DAP request. */
    public callCustom(command : string, args : any = {}) : DebugProtocol.Response
    {
        const response = dapResponse(command);
        this.customRequest(command, response, args);
        return response;
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

    /** Invoke launchRequest for tests. */
    public async callLaunch(args : any) : Promise<DebugProtocol.LaunchResponse>
    {
        const response = dapResponse("launch") as DebugProtocol.LaunchResponse;
        await this.launchRequest(response, args);
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

    /** Invoke pauseRequest for tests. */
    public async callPause() : Promise<DebugProtocol.PauseResponse>
    {
        const response = dapResponse("pause") as DebugProtocol.PauseResponse;
        await this.pauseRequest(response, { threadId: this.mainQmlThreadId });
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
function createSession() : { session : TestQmlDebugSession; packetManager : MockPacketManager; v8 : MockV8Debugger; declarative : MockDeclarativeDebugClient; qmlDebugger : MockQmlDebugger; inspector : MockInspector; profiler : MockProfiler; launched : any[]; child : MockChildProcess }
{
    const packetManager = new MockPacketManager();
    const v8 = new MockV8Debugger();
    const declarative = new MockDeclarativeDebugClient();
    const qmlDebugger = new MockQmlDebugger();
    const inspector = new MockInspector();
    const profiler = new MockProfiler();
    const launched : any[] = [];
    const child = new MockChildProcess();
    const session = new TestQmlDebugSession({} as any,
        {
            packetManager: packetManager,
            qmlDebugger: qmlDebugger,
            debugMessages: new MockLifecycleService(),
            v8debugger: v8,
            declarativeDebugClient: declarative,
            inspector: inspector,
            profiler: profiler,
            processLauncher: (options : any) : any =>
            {
                launched.push(options);
                return child;
            }
        } as any
    );

    return {
        session: session,
        packetManager: packetManager,
        v8: v8,
        declarative: declarative,
        qmlDebugger: qmlDebugger,
        inspector: inspector,
        profiler: profiler,
        launched: launched,
        child: child
    };
}

describe("QmlDebugSession", () =>
{
    it("reports modern DAP capabilities on initialize", async () =>
    {
        const { session } = createSession();

        const response = await session.callInitialize({ adapterID: "qml", linesStartAt1: true, columnsStartAt1: true });

        assert.strictEqual(response.body!.supportsConfigurationDoneRequest, true);
        assert.strictEqual(response.body!.supportsFunctionBreakpoints, false);
        assert.strictEqual(response.body!.supportsEvaluateForHovers, true);
        assert.strictEqual(response.body!.exceptionBreakpointFilters![0].filter, "all");
        assert.strictEqual(response.body!.exceptionBreakpointFilters![1].filter, "uncaught");
    });

    it("surfaces negotiated Qt services through a custom capabilities request", () =>
    {
        const { session } = createSession();

        const response = session.callCustom("qml/getCapabilities");

        assert.strictEqual(response.success, true);
        assert.strictEqual(response.body.protocolVersion, 1);
        assert.strictEqual(response.body.dataStreamVersion, 12);
        assert.strictEqual(response.body.inspectorAvailable, true);
        assert.strictEqual(response.body.profilerAvailable, true);
        assert.strictEqual(response.body.services.some((service : any) => service.name === "QmlInspector"), true);
    });

    it("selects inspector objects by source location through QmlDebugger lookups", async () =>
    {
        const { session, qmlDebugger, inspector } = createSession();

        const response = session.callCustom("qml/inspector/selectBySource", { path: "/project/qml/Main.qml", line: 12, column: 3 });
        await Promise.resolve();
        await Promise.resolve();

        assert.strictEqual(qmlDebugger.objectLookupCalls.length, 1);
        assert.deepStrictEqual(qmlDebugger.objectLookupCalls[0], { filename: "Main.qml", lineNumber: 12, columnNumber: 3 });
        assert.deepStrictEqual(response.body.matchedObjectIds, [ 41, 42 ]);
        assert.deepStrictEqual(inspector.currentObjectIds, [ 41, 42 ]);
    });

    it("returns decoded inspector object metadata for the active selection", async () =>
    {
        const { session, qmlDebugger, inspector } = createSession();
        inspector.currentObjectIds = [ 41 ];

        const response = session.callCustom("qml/inspector/objectTree");
        await Promise.resolve();
        await Promise.resolve();

        assert.deepStrictEqual(qmlDebugger.objectTreeCalls, [ [ 41 ] ]);
        assert.deepStrictEqual(response.body.selectedObjectIds, [ 41 ]);
        assert.strictEqual(response.body.objects[0].className, "QQuickRectangle");
        assert.strictEqual(response.body.objects[0].properties[0].decodedValue, "red");
        assert.deepStrictEqual(response.body.contexts, [ { debugId: 7, objectIds: [ 41 ] } ]);
    });

    it("starts and stops profiler capture through custom requests", async () =>
    {
        const { session, profiler } = createSession();

        const start = session.callCustom("qml/profiler/start", { featureMask: "8", flushInterval: 50 });
        await Promise.resolve();
        await Promise.resolve();

        assert.strictEqual(start.body.recording, true);
        assert.strictEqual(start.body.requestedFeatureMask, "8");
        assert.strictEqual(start.body.flushInterval, 50);
        assert.strictEqual(profiler.recording, true);

        const stop = session.callCustom("qml/profiler/stop");
        await Promise.resolve();
        await Promise.resolve();

        assert.strictEqual(stop.body.recording, false);
        assert.strictEqual(profiler.recording, false);
    });

    it("exports profiler data as a structured timeline snapshot", () =>
    {
        const { session } = createSession();

        const response = session.callCustom("qml/profiler/export");

        assert.strictEqual(response.success, true);
        assert.strictEqual(response.body.summary.packetCount, 1);
        assert.deepStrictEqual(response.body.eventKinds, [ { kind: "uint64", count: 1 } ]);
        assert.strictEqual(response.body.timeline[0].decodedValue, 8);
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

    it("launches a QML process with generated debugger arguments and attaches", async () =>
    {
        const { session, packetManager, launched, v8 } = createSession();

        await session.callLaunch(
            {
                program: "/fixtures/fake-qml-app",
                args: [ "--mode", "demo", "-qmljsdebugger=old" ],
                cwd: "/fixtures",
                env: { QML_IMPORT_PATH: "/fixtures/qml" },
                host: "127.0.0.1",
                port: 23456,
                paths: { "qrc:/qml": "/fixtures/qml" },
                services: [ "DebugMessages", "QmlDebugger", "V8Debugger" ],
                block: true
            }
        );

        assert.strictEqual(launched.length, 1);
        assert.strictEqual(launched[0].program, "/fixtures/fake-qml-app");
        assert.deepStrictEqual(launched[0].args, [ "--mode", "demo", "-qmljsdebugger=host:127.0.0.1,port:23456,block,services:DebugMessages,QmlDebugger,V8Debugger" ]);
        assert.strictEqual(launched[0].cwd, "/fixtures");
        assert.strictEqual(launched[0].env.QML_IMPORT_PATH, "/fixtures/qml");
        assert.strictEqual(packetManager.host, "127.0.0.1");
        assert.strictEqual(packetManager.port, 23456);
        assert.strictEqual(v8.handshakeCount, 1);
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

        const hover = await session.callEvaluate({ expression: "title", context: "hover" });
        assert.strictEqual(hover.body!.result, "\"hello\"");
    });

    it("routes pause, stepping, exception and disconnect requests to mocked services", async () =>
    {
        const { session, packetManager, v8, declarative } = createSession();

        await session.callSetExceptionBreakpoints([ "all", "uncaught" ]);
        await session.callPause();
        await session.callStep("in");
        await session.callStep("next");
        await session.callStep("out");
        await session.callStep("continue");
        await session.callAttach({ host: "localhost", port: 12150, paths: {} });
        await session.callDisconnect();

        assert.deepStrictEqual(v8.exceptionRequests, [ { type: "all", enabled: true }, { type: "uncaught", enabled: true } ]);
        assert.deepStrictEqual(v8.continueCalls.slice(0, 4), [ { stepAction: "in", stepCount: 1 }, { stepAction: "next", stepCount: 1 }, { stepAction: "out", stepCount: 1 }, { stepAction: undefined, stepCount: undefined } ]);
        assert.strictEqual(session.events.some((event) => event.event === "stopped" && (event as DebugProtocol.StoppedEvent).body.reason === "pause"), true);
        assert.strictEqual(packetManager.connectCount, 1);
        assert.strictEqual(packetManager.disconnectCount, 1);
        assert.strictEqual(declarative.handshakeCount, 1);
        assert.strictEqual(v8.disconnectCount, 1);
    });
});
