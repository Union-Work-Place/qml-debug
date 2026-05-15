import assert = require("assert");
import Packet from "@qml-debug/packet";
import ServiceQmlDebugger from "@qml-debug/service-qml-debugger";
import ServiceQmlInspector from "@qml-debug/service-qml-inspector";
import ServiceV8Debugger from "@qml-debug/service-v8-debugger";
import ServiceDeclarativeDebugClient from "@qml-debug/service-declarative-debug-client";
import { QmlDebugSession } from "@qml-debug/debug-adapter";
import { DebugProtocol } from "@vscode/debugprotocol";


type PacketHandler = (header : string, packet : Packet) => boolean;
type TransportCloseHandler = (error : Error) => void;

/** Minimal packet transport mock used by service lifecycle tests. */
class MockPacketManager
{
    /** Active host value used by attach error messages. */
    public host = "localhost";
    /** Active port value used by attach error messages. */
    public port = 12150;
    /** Number of connect calls. */
    public connectCount = 0;
    /** Number of disconnect calls. */
    public disconnectCount = 0;
    /** Registered service handlers. */
    public readonly handlers = new Map<string, PacketHandler[]>();
    /** Registered transport-close listeners. */
    public readonly transportCloseHandlers : TransportCloseHandler[] = [];
    /** Write implementation injected per test. */
    public writePacketImpl : (packet : Packet) => Promise<void> = async () : Promise<void> => undefined;

    /** Record a mock connection. */
    public async connect() : Promise<void>
    {
        this.connectCount++;
    }

    /** Record a mock disconnect and notify transport listeners. */
    public async disconnect() : Promise<void>
    {
        this.disconnectCount++;
        this.emitTransportClosed("mock disconnect");
    }

    /** Register a service handler. */
    public registerHandler(header : string, callback : PacketHandler) : void
    {
        const handlers = this.handlers.get(header) ?? [];
        handlers.push(callback);
        this.handlers.set(header, handlers);
    }

    /** Register a transport-close callback. */
    public registerTransportCloseHandler(callback : TransportCloseHandler) : void
    {
        this.transportCloseHandlers.push(callback);
    }

    /** Delegate a write to the injected implementation. */
    public async writePacket(packet : Packet) : Promise<void>
    {
        await this.writePacketImpl(packet);
    }

    /** Notify every transport-close listener with the provided error. */
    public emitTransportClosed(message : string) : void
    {
        const error = new Error(message);
        for (const current of this.transportCloseHandlers)
            current(error);
    }
}

/** Declarative service stub that reports a fixed set of available services. */
class MockDeclarativeService
{
    /** Service names considered available for the session. */
    private readonly serviceNames : string[];

    /** Create a declarative service stub. */
    public constructor(serviceNames : string[])
    {
        this.serviceNames = serviceNames;
    }

    /** No-op initializer for session construction. */
    public async initialize() : Promise<void>
    {
        return undefined;
    }

    /** No-op shutdown hook for session construction. */
    public async deinitialize() : Promise<void>
    {
        return undefined;
    }

    /** No-op handshake used only by custom request tests. */
    public async handshake() : Promise<void>
    {
        return undefined;
    }

    /** Return a deterministic negotiated capability snapshot. */
    public getCapabilities() : any
    {
        return {
            protocolVersion: 1,
            dataStreamVersion: 12,
            services: this.serviceNames.map((name) =>
            {
                return {
                    name: name,
                    version: 1
                };
            })
        };
    }

    /** Return true when the requested service is available. */
    public isServiceAvailable(name : string) : boolean
    {
        return this.serviceNames.includes(name);
    }
}

/** Testable QML session that captures responses instead of writing to stdio. */
class TestQmlDebugSession extends QmlDebugSession
{
    /** Captured responses for assertions. */
    public readonly responses : DebugProtocol.Response[] = [];

    /** Captured events for assertions. */
    public readonly events : DebugProtocol.Event[] = [];

    /** Capture a DAP response. */
    public sendResponse(response : DebugProtocol.Response) : void
    {
        this.responses.push(response);
    }

    /** Capture a DAP event. */
    public sendEvent(event : DebugProtocol.Event) : void
    {
        this.events.push(event);
    }

    /** Capture a DAP error response. */
    protected sendErrorResponse(response : DebugProtocol.Response, codeOrMessage : any, format? : string, variables? : any, dest? : any) : void
    {
        response.success = false;
        response.message = typeof codeOrMessage === "object" ? codeOrMessage.format : format;
        this.responses.push(response);
    }

    /** Invoke attachRequest for tests. */
    public async callAttach(args : any) : Promise<DebugProtocol.AttachResponse>
    {
        const response = makeResponse("attach") as DebugProtocol.AttachResponse;
        await this.attachRequest(response, args);
        return response;
    }

    /** Invoke a custom request for tests. */
    public callCustom(command : string, args : any = {}) : DebugProtocol.Response
    {
        const response = makeResponse(command);
        this.customRequest(command, response, args);
        return response;
    }
}

/** Create a DAP response shell for tests. */
function makeResponse(command : string) : DebugProtocol.Response
{
    return {
        type: "response",
        seq: 1,
        request_seq: 1,
        command: command,
        success: true
    };
}

/** Create the minimal session surface required by the service wrappers. */
function createServiceSession(packetManager : MockPacketManager) : any
{
    return {
        packetManager: packetManager,
        sendEvent: () : void => undefined,
        onEvent: () : void => undefined,
        mapPathFrom: (filename : string) : string => filename
    };
}

/** Allow async custom-request error handling to flush back into the captured response list. */
async function flushCustomRequest() : Promise<void>
{
    await new Promise<void>((resolve) =>
    {
        setImmediate(resolve);
    });
}

/** Build a declarative handshake packet with the requested service list. */
function makeHandshakePacket(serviceNames : string[], versions : number[] = serviceNames.map(() : number => 1)) : Packet
{
    const packet = new Packet();
    packet.appendInt32BE(0);
    packet.appendUInt32BE(1);
    packet.appendArray(Packet.prototype.appendStringUTF16, serviceNames);
    packet.appendArray(Packet.prototype.appendDouble, versions);
    packet.appendUInt32BE(12);
    return packet;
}

describe("Phase 9 transport lifecycle", () =>
{
    it("fails attach immediately when the declarative handshake write fails", async () =>
    {
        const packetManager = new MockPacketManager();
        packetManager.writePacketImpl = async () : Promise<void> =>
        {
            throw new Error("attach write failed");
        };

        const session = new TestQmlDebugSession({} as any,
            {
                packetManager: packetManager
            } as any
        );

        const response = await session.callAttach({ host: "localhost", port: 12150, paths: {} });

        assert.strictEqual(response.success, false);
        assert.notStrictEqual(response.message, undefined);
        assert.strictEqual(response.message!.includes("attach write failed"), true);
        assert.strictEqual(packetManager.disconnectCount, 1);
    });

    it("fails inspector actions immediately on transport write errors", async () =>
    {
        const packetManager = new MockPacketManager();
        packetManager.writePacketImpl = async () : Promise<void> =>
        {
            throw new Error("inspector write failed");
        };

        const session = new TestQmlDebugSession({} as any,
            {
                packetManager: packetManager,
                declarativeDebugClient: new MockDeclarativeService([ "QmlInspector" ])
            } as any
        );

        const response = session.callCustom("qml/inspector/setEnabled", { enabled: true });
        await flushCustomRequest();

        const inspector = (session as any).inspector as ServiceQmlInspector;
        const finalResponse = session.responses[session.responses.length - 1] ?? response;
        assert.strictEqual(finalResponse.success, false);
        assert.notStrictEqual(finalResponse.message, undefined);
        assert.strictEqual(finalResponse.message!.includes("inspector write failed"), true);
        assert.strictEqual(inspector.getSnapshot().pendingRequestCount, 0);
    });

    it("fails object-tree expansion immediately on transport write errors", async () =>
    {
        const packetManager = new MockPacketManager();
        packetManager.writePacketImpl = async () : Promise<void> =>
        {
            throw new Error("qml debugger write failed");
        };

        const session = new TestQmlDebugSession({} as any,
            {
                packetManager: packetManager,
                declarativeDebugClient: new MockDeclarativeService([ "QmlDebugger" ])
            } as any
        );

        const response = session.callCustom("qml/inspector/objectTree", { objectIds: [ 41 ] });
        await flushCustomRequest();

        const qmlDebugger = (session as any).qmlDebugger as ServiceQmlDebugger;
        const finalResponse = session.responses[session.responses.length - 1] ?? response;
        assert.strictEqual(finalResponse.success, false);
        assert.notStrictEqual(finalResponse.message, undefined);
        assert.strictEqual(finalResponse.message!.includes("qml debugger write failed"), true);
        assert.strictEqual(qmlDebugger.awaitingRequests.length, 0);
    });

    it("purges timed-out QmlDebugger requests", async () =>
    {
        const packetManager = new MockPacketManager();
        packetManager.writePacketImpl = async () : Promise<void> => new Promise(() : void => undefined);
        const service = new ServiceQmlDebugger(createServiceSession(packetManager) as any);
        const originalSetTimeout = global.setTimeout;
        (global as any).setTimeout = ((callback : (...args : any[]) => void) : NodeJS.Timeout =>
        {
            return originalSetTimeout(callback, 0);
        }) as any;

        try
        {
            await assert.rejects(service.requestObjectTreeSnapshot([ 7 ]), /QmlDebugger request timed out/);
            assert.strictEqual(service.awaitingRequests.length, 0);
        }
        finally
        {
            global.setTimeout = originalSetTimeout;
        }
    });

    it("rejects pending QmlDebugger requests when the transport closes", async () =>
    {
        const packetManager = new MockPacketManager();
        packetManager.writePacketImpl = async () : Promise<void> => new Promise(() : void => undefined);
        const service = new ServiceQmlDebugger(createServiceSession(packetManager) as any);

        const request = service.requestObjectTreeSnapshot([ 7 ]);
        await Promise.resolve();
        assert.strictEqual(service.awaitingRequests.length, 1);

        packetManager.emitTransportClosed("socket lost");

        await assert.rejects(request, /QmlDebugger transport closed/);
        assert.strictEqual(service.awaitingRequests.length, 0);
    });

    it("rejects pending inspector requests on deinitialize", async () =>
    {
        const packetManager = new MockPacketManager();
        packetManager.writePacketImpl = async () : Promise<void> => new Promise(() : void => undefined);
        const service = new ServiceQmlInspector(createServiceSession(packetManager) as any);

        const request = service.selectObjects([ 1, 2 ]);
        await Promise.resolve();
        assert.strictEqual(service.getSnapshot().pendingRequestCount, 1);

        await service.deinitialize();

        await assert.rejects(request, /QmlInspector service disconnected/);
        assert.strictEqual(service.getSnapshot().pendingRequestCount, 0);
    });

    it("rejects pending V8 connect and request promises on deinitialize", async () =>
    {
        const packetManager = new MockPacketManager();
        packetManager.writePacketImpl = async () : Promise<void> => new Promise(() : void => undefined);
        const service = new ServiceV8Debugger(createServiceSession(packetManager) as any);

        const connectRequest = service.connect();
        const versionRequest = service.requestVersion();
        await Promise.resolve();

        await service.deinitialize();

        await assert.rejects(connectRequest, /V8Debugger service disconnected/);
        await assert.rejects(versionRequest, /V8Debugger service disconnected/);
    });

    it("fails closed on malformed declarative handshake operations", async () =>
    {
        const packetManager = new MockPacketManager();
        const service = new ServiceDeclarativeDebugClient(createServiceSession(packetManager) as any);
        const handshake = service.handshake();
        await Promise.resolve();

        const packet = new Packet();
        packet.appendInt32BE(99);
        (service as any).packetReceived(packet);

        await assert.rejects(handshake, /Unknown QDeclarativeDebugClient operation/);
        assert.strictEqual(packetManager.disconnectCount, 1);
    });

    it("fails closed when required declarative services are missing", async () =>
    {
        const packetManager = new MockPacketManager();
        const service = new ServiceDeclarativeDebugClient(createServiceSession(packetManager) as any);
        const handshake = service.handshake();
        await Promise.resolve();

        (service as any).packetReceived(makeHandshakePacket([ "DebugMessages" ]));

        await assert.rejects(handshake, /Required debugger services? not found/);
        assert.strictEqual(packetManager.disconnectCount, 1);
    });
});
