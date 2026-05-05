import Log from "@qml-debug/log";
import Packet from "@qml-debug/packet";
import { QmlDebugSession } from "@qml-debug/debug-adapter";


interface InspectorAwaitingRequest
{
    requestId : number;
    resolve(value : boolean) : void;
    reject(error : Error) : void;
    timerId : NodeJS.Timeout;
}

export interface QmlInspectorSnapshot
{
    enabled : boolean;
    showAppOnTop : boolean;
    currentObjectIds : number[];
    pendingRequestCount : number;
}

export default class ServiceQmlInspector
{
    private requestId = 0;
    private session? : QmlDebugSession;
    private awaitingRequests : InspectorAwaitingRequest[] = [];
    private enabled = false;
    private showAppOnTop = false;
    private currentObjectIds : number[] = [];

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

    private nextRequestId() : number
    {
        this.requestId++;
        return this.requestId;
    }

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

    public getSnapshot() : QmlInspectorSnapshot
    {
        return {
            enabled: this.enabled,
            showAppOnTop: this.showAppOnTop,
            currentObjectIds: [ ...this.currentObjectIds ],
            pendingRequestCount: this.awaitingRequests.length
        };
    }

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

    public async initialize() : Promise<void>
    {
        Log.trace("ServiceQmlInspector.initialize", []);
        this.enabled = false;
        this.showAppOnTop = false;
        this.currentObjectIds = [];
    }

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