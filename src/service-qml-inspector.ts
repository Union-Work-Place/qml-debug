import Log from "@qml-debug/log";
import Packet from "@qml-debug/packet";
import { QmlDebugSession } from "@qml-debug/debug-adapter";


/** In-flight QmlInspector request tracked until Qt replies or times out. */
interface InspectorAwaitingRequest
{
    /** Monotonic request id used by the wire protocol. */
    requestId : number;
    /** Promise resolver invoked when Qt acknowledges the request. */
    resolve(value : boolean) : void;
    /** Promise reject callback invoked on timeout or transport failure. */
    reject(error : Error) : void;
    /** Timeout guard for the request. */
    timerId : NodeJS.Timeout;
}

/** Lightweight snapshot of the QmlInspector service state. */
export interface QmlInspectorSnapshot
{
    /** Whether the interactive inspect tool is enabled. */
    enabled : boolean;
    /** Whether the inspected app is forced on top of other windows. */
    showAppOnTop : boolean;
    /** Currently selected runtime object ids. */
    currentObjectIds : number[];
    /** Number of requests waiting for a Qt response. */
    pendingRequestCount : number;
}

/** Service wrapper around the Qt QmlInspector protocol. */
export default class ServiceQmlInspector
{
    /** Monotonic request id counter. */
    private requestId = 0;
    /** Owning debug session used for transport access. */
    private session? : QmlDebugSession;
    /** Requests waiting for a QmlInspector reply. */
    private awaitingRequests : InspectorAwaitingRequest[] = [];
    /** Whether the inspect tool is enabled in the target runtime. */
    private enabled = false;
    /** Whether the target app should stay on top while inspecting. */
    private showAppOnTop = false;
    /** Currently selected runtime object ids. */
    private currentObjectIds : number[] = [];

    /** Decode an incoming QmlInspector packet and reconcile local state. */
    private packetReceived(packet : Packet) : void
    {
        Log.trace("ServiceQmlInspector.packetReceived", [ packet ]);

        const messageType = packet.readByteArray().toString("latin1");
        const requestId = packet.readInt32BE();

        if (messageType === "response")
        {
            const success = packet.readBoolean();
            for (let index = 0; index < this.awaitingRequests.length; index++)
            {
                const current = this.awaitingRequests[index];
                if (current.requestId !== requestId)
                    continue;

                this.awaitingRequests.splice(index, 1);
                clearTimeout(current.timerId);
                current.resolve(success);
                return;
            }

            Log.warning("QmlInspector response with unknown request id " + requestId + ".");
            return;
        }

        if (messageType === "event")
        {
            const eventName = packet.readByteArray().toString("latin1");
            if (eventName === "select")
            {
                this.currentObjectIds = packet.readArray<number>(() : number => { return packet.readInt32BE(); })
                    .filter((value) : boolean => { return value !== -1; });
            }

            return;
        }

        Log.warning("QmlInspector packet with unknown message type " + messageType + ".");
    }

    /** Allocate the next wire-protocol request id. */
    private nextRequestId() : number
    {
        this.requestId++;
        return this.requestId;
    }

    /** Send a QmlInspector request and wait for the matching response. */
    private async sendRequest(command : string, writeData? : (packet : Packet) => void) : Promise<boolean>
    {
        Log.trace("ServiceQmlInspector.sendRequest", [ command ]);

        return new Promise<boolean>((resolve, reject) =>
        {
            const requestId = this.nextRequestId();
            const packet = new Packet();
            packet.appendByteArray(Buffer.from("request", "latin1"));
            packet.appendInt32BE(requestId);
            packet.appendByteArray(Buffer.from(command, "latin1"));

            if (writeData !== undefined)
                writeData(packet);

            const envelope = new Packet();
            envelope.appendStringUTF16("QmlInspector");
            envelope.appendSubPacket(packet);

            const timerId = setTimeout(() : void =>
            {
                this.finishRequest(requestId);
                reject(new Error("QmlInspector request timed out. Request Id: " + requestId));
            }, 10000);

            this.awaitingRequests.push({ requestId: requestId, resolve: resolve, reject: reject, timerId: timerId });

            this.session!.packetManager.writePacket(envelope).catch((error) =>
            {
                this.finishRequest(requestId);
                reject(error);
            });
        });
    }

    /** Remove an outstanding request and cancel its timeout guard. */
    private finishRequest(requestId : number) : void
    {
        for (let index = 0; index < this.awaitingRequests.length; index++)
        {
            const current = this.awaitingRequests[index];
            if (current.requestId !== requestId)
                continue;

            clearTimeout(current.timerId);
            this.awaitingRequests.splice(index, 1);
            return;
        }
    }

    /** Return a snapshot of the last known QmlInspector state. */
    public getSnapshot() : QmlInspectorSnapshot
    {
        return {
            enabled: this.enabled,
            showAppOnTop: this.showAppOnTop,
            currentObjectIds: [ ...this.currentObjectIds ],
            pendingRequestCount: this.awaitingRequests.length
        };
    }

    /** Enable or disable the interactive inspect tool. */
    public async setInspectToolEnabled(enabled : boolean) : Promise<QmlInspectorSnapshot>
    {
        const success = await this.sendRequest(enabled ? "enable" : "disable");
        if (!success)
            throw new Error("QmlInspector refused to " + (enabled ? "enable" : "disable") + " inspection mode.");

        this.enabled = enabled;
        if (!enabled)
            this.currentObjectIds = [];

        return this.getSnapshot();
    }

    /** Toggle the app-on-top mode used during interactive inspection. */
    public async setShowAppOnTop(showAppOnTop : boolean) : Promise<QmlInspectorSnapshot>
    {
        const success = await this.sendRequest("showAppOnTop", (packet : Packet) : void =>
        {
            packet.appendBoolean(showAppOnTop);
        });

        if (!success)
            throw new Error("QmlInspector could not change the app-on-top state.");

        this.showAppOnTop = showAppOnTop;
        return this.getSnapshot();
    }

    /** Select runtime objects inside the Qt inspector service. */
    public async selectObjects(objectIds : number[]) : Promise<QmlInspectorSnapshot>
    {
        const success = await this.sendRequest("select", (packet : Packet) : void =>
        {
            packet.appendArray<number>((value : number) : void => { packet.appendInt32BE(value); }, objectIds);
        });

        if (!success)
            throw new Error("QmlInspector could not select the requested objects.");

        this.currentObjectIds = [ ...objectIds ];
        return this.getSnapshot();
    }

    /** Reset transient state before the service becomes active. */
    public async initialize() : Promise<void>
    {
        Log.trace("ServiceQmlInspector.initialize", []);
        this.enabled = false;
        this.showAppOnTop = false;
        this.currentObjectIds = [];
    }

    /** Clear local state and cancel any in-flight inspector requests. */
    public async deinitialize() : Promise<void>
    {
        Log.trace("ServiceQmlInspector.deinitialize", []);
        this.enabled = false;
        this.showAppOnTop = false;
        this.currentObjectIds = [];
        for (const current of this.awaitingRequests)
            clearTimeout(current.timerId);
        this.awaitingRequests = [];
    }

    /** Register the QmlInspector packet handler on the shared transport. */
    public constructor(session : QmlDebugSession)
    {
        Log.trace("ServiceQmlInspector.constructor", [ session ]);

        this.session = session;
        this.session.packetManager.registerHandler("QmlInspector",
            (header, packet) : boolean =>
            {
                const servicePacket = packet.readSubPacket();
                this.packetReceived(servicePacket);
                return true;
            }
        );
    }
}