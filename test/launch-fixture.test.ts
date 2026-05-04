import assert = require("assert");
import fs = require("fs");
import path = require("path");
import { EventEmitter } from "events";
import PacketManager from "@qml-debug/packet-manager";
import { QmlDebugSession } from "@qml-debug/debug-adapter";
import { DebugProtocol } from "@vscode/debugprotocol";

/** Load the fixture launch configuration used as a small QML-app integration scenario. */
function loadFixtureLaunchConfig() : any
{
    const workspaceFolder = process.cwd();
    const fixturePath = path.join(workspaceFolder, "test", "fixtures", "launch.json");
    const raw = fs.readFileSync(fixturePath, "utf8").replace(/\$\{workspaceFolder\}/g, workspaceFolder);
    return JSON.parse(raw);
}

/** DAP response shell for integration-style handler calls. */
function response(command : string) : any
{
    return { type: "response", seq: 1, request_seq: 1, command: command, success: true };
}

/** Small mock packet manager for launch fixture tests. */
class FixturePacketManager extends PacketManager
{
    /** Number of mock connect calls. */
    public connectCount = 0;

    /** Create an inert packet manager. */
    public constructor()
    {
        super({} as any);
    }

    /** Record a mock connect call. */
    public async connect() : Promise<void>
    {
        this.connectCount++;
    }

    /** Ignore disconnect calls in this fixture test. */
    public async disconnect() : Promise<void>
    {
        return undefined;
    }
}

/** Minimal lifecycle service used by the fixture launch test. */
class FixtureLifecycleService
{
    /** Initialize no-op service. */
    public async initialize() : Promise<void>
    {
        return undefined;
    }

    /** Deinitialize no-op service. */
    public async deinitialize() : Promise<void>
    {
        return undefined;
    }
}

/** Declarative debug service mock for fixture launch. */
class FixtureDeclarativeDebugClient extends FixtureLifecycleService
{
    /** Record a successful handshake. */
    public async handshake() : Promise<void>
    {
        return undefined;
    }
}

/** V8 service mock for fixture launch. */
class FixtureV8Debugger extends FixtureLifecycleService
{
    /** Record a successful handshake. */
    public async handshake() : Promise<void>
    {
        return undefined;
    }

    /** Ignore V8 disconnect. */
    public async disconnect() : Promise<void>
    {
        return undefined;
    }

    /** Return a successful continue response. */
    public async requestContinue() : Promise<any>
    {
        return { success: true };
    }

    /** Return a successful breakpoint response. */
    public async requestSetBreakpoint() : Promise<any>
    {
        return { success: true, body: { breakpoint: 1 } };
    }

    /** Return a successful breakpoint clear response. */
    public async requestClearBreakpoint() : Promise<any>
    {
        return { success: true };
    }

    /** Return a successful exception breakpoint response. */
    public async requestSetExceptionBreakpoint() : Promise<any>
    {
        return { success: true };
    }

    /** Return an empty stack response. */
    public async requestBacktrace() : Promise<any>
    {
        return { success: true, body: { frames: [] } };
    }

    /** Return an empty frame response. */
    public async requestFrame() : Promise<any>
    {
        return { success: true, body: { scopes: [] } };
    }

    /** Return an empty scope response. */
    public async requestScope() : Promise<any>
    {
        return { success: true, body: {} };
    }

    /** Return an empty lookup response. */
    public async requestLookup() : Promise<any>
    {
        return { success: true, body: {} };
    }

    /** Return a fixture evaluate response. */
    public async requestEvaluate() : Promise<any>
    {
        return { success: true, body: { type: "string", value: "Fixture", handle: 1 } };
    }

    /** Return a successful pause response. */
    public async requestPause() : Promise<any>
    {
        return { success: true };
    }
}

/** Testable session exposing launchRequest for the fixture integration test. */
class FixtureSession extends QmlDebugSession
{
    /** Captured DAP responses. */
    public readonly responses : DebugProtocol.Response[] = [];

    /** Capture DAP responses. */
    public sendResponse(responseParam : DebugProtocol.Response) : void
    {
        this.responses.push(responseParam);
    }

    /** Capture DAP events without writing to stdio. */
    public sendEvent(event : DebugProtocol.Event) : void
    {
        void event;
    }

    /** Capture DAP error responses. */
    protected sendErrorResponse(responseParam : DebugProtocol.Response, codeOrMessage : any, format? : string, variables? : any, dest? : any) : void
    {
        responseParam.success = false;
        responseParam.message = typeof codeOrMessage === "object" ? codeOrMessage.format : format;
        this.responses.push(responseParam);
    }

    /** Invoke launchRequest. */
    public async callLaunch(args : any) : Promise<DebugProtocol.LaunchResponse>
    {
        const launchResponse = response("launch") as DebugProtocol.LaunchResponse;
        await this.launchRequest(launchResponse, args);
        return launchResponse;
    }
}

describe("QML launch fixture", () =>
{
    it("launches the fixture configuration with generated qmljsdebugger arguments", async () =>
    {
        const config = loadFixtureLaunchConfig();
        const packetManager = new FixturePacketManager();
        const launched : any[] = [];
        const child = new EventEmitter() as any;
        child.killed = false;
        child.kill = () : boolean =>
        {
            child.killed = true;
            return true;
        };

        const session = new FixtureSession({} as any,
            {
                packetManager: packetManager,
                qmlDebugger: new FixtureLifecycleService(),
                debugMessages: new FixtureLifecycleService(),
                v8debugger: new FixtureV8Debugger(),
                declarativeDebugClient: new FixtureDeclarativeDebugClient(),
                processLauncher: (options : any) : any =>
                {
                    launched.push(options);
                    return child;
                }
            } as any
        );

        const launchResponse = await session.callLaunch(config);

        assert.strictEqual(launchResponse.success, true);
        assert.strictEqual(packetManager.connectCount, 1);
        assert.strictEqual(launched[0].program.endsWith("test/fixtures/fake-qml-app"), true);
        assert.strictEqual(launched[0].args[0], "--fixture");
        assert.strictEqual(launched[0].args[1], "-qmljsdebugger=host:127.0.0.1,port:23456,block,services:DebugMessages,QmlDebugger,V8Debugger,QmlInspector");
        assert.strictEqual(session.mapPathFrom("qrc:/qml/Main.qml").endsWith("test/fixtures/qml/Main.qml"), true);
    });
});
