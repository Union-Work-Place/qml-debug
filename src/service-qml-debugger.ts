import Log  from "@qml-debug/log";
import Packet from "@qml-debug/packet";
import { QmlDebugSession } from "@qml-debug/debug-adapter";


interface QmlEngine
{
    /** Human-readable engine name reported by the Qt runtime. */
    name : string;
    /** Runtime identifier used by subsequent QmlDebugger requests. */
    debugId : number;
}

/** Decoded QmlDebugger object reference including optional subtree metadata. */
export interface QmlDebugObjectReference
{
    /** Runtime object id used by QmlDebugger requests. */
    debugId : number;
    /** Concrete Qt class name for the runtime object. */
    className : string;
    /** QML id string, when the object defines one. */
    idString : string;
    /** Display name reported by the runtime. */
    name : string;
    /** Source location where the object was declared. */
    source : {
        /** Source URL or file name reported by Qt. */
        url : string;
        /** 1-based source line reported by Qt. */
        lineNumber : number;
        /** 1-based source column reported by Qt. */
        columnNumber : number;
    };
    /** Context id that owns the object. */
    contextDebugId : number;
    /** Parent runtime object id, or -1 for a root object. */
    parentDebugId : number;
    /** Number of decoded property payloads. */
    propertyCount : number;
    /** Decoded property payloads for the object. */
    properties : QmlDebugProperty[];
    /** Child objects that belong to the decoded subtree. */
    children : QmlDebugObjectReference[];
}

/** Decoded property payload attached to a QmlDebugger object. */
export interface QmlDebugProperty
{
    /** Qt metatype id for the serialized property value. */
    typeId : number;
    /** Property name. */
    name : string;
    /** Raw serialized payload represented as hexadecimal text. */
    rawValue : string;
    /** Qt type name reported for the payload. */
    valueTypeName : string;
    /** String form reported by Qt for display purposes. */
    valueContents : string;
    /** Whether the property exposes a notify signal. */
    hasNotifySignal : boolean;
    /** Best-effort decoded primitive value when the type is recognized. */
    decodedValue : null | boolean | number | string;
}

/** Context grouping used by the inspector tree view. */
export interface QmlDebugContextNode
{
    /** Runtime context id. */
    debugId : number;
    /** Runtime object ids that belong to the context subtree. */
    objectIds : number[];
}

/** Materialized subtree returned for one or more selected runtime object ids. */
export interface QmlDebugObjectTreeSnapshot
{
    /** Requested selection after de-duplication and filtering. */
    selectedObjectIds : number[];
    /** Decoded root objects for the selection. */
    objects : QmlDebugObjectReference[];
    /** Context groupings derived from the decoded subtree. */
    contexts : QmlDebugContextNode[];
}

/** In-flight request bookkeeping for asynchronous QmlDebugger commands. */
interface ServiceAwaitingRequest
{
    /** Monotonic request sequence id. */
    seqId : number;
    /** Promise resolver for a matching service response. */
    resolve: any;
    /** Promise reject callback for timeouts and transport failures. */
    reject: any;
    /** Timeout guard for the request. */
    timerId : NodeJS.Timeout;
}

/** Service wrapper around the Qt QmlDebugger protocol. */
export default class ServiceQmlDebugger
{
    /** Monotonic sequence id for service requests. */
    private seqId = 0;
    /** Owning debug session used for transport access. */
    protected session? : QmlDebugSession;
    /** Outstanding asynchronous requests awaiting a Qt reply. */
    public awaitingRequests : ServiceAwaitingRequest[] = [];

    /** Request the list of active QML engines from the runtime. */
    public async requestListEngines() : Promise<QmlEngine[]>
    {
        Log.trace("QmlDebugger.requestListEngines", []);

        const packet = await this.makeRequest("LIST_ENGINES");

        const count = packet.readUInt32BE();
        const engines : QmlEngine[] = [];
        for (let i = 0; i < count; i++)
        {
            const name = packet.readStringUTF8();
            const id = packet.readUInt32BE();
            engines.push(
                {
                    name: name,
                    debugId: id
                }
            );
        }

        return engines;
    }

    /** Decode a primitive property payload when its Qt metatype is recognized. */
    private decodePropertyValue(typeId : number, valueContents : string, rawValue : Buffer) : null | boolean | number | string
    {
        if (rawValue.length === 0)
            return valueContents === "" ? null : valueContents;

        try
        {
            const packet = new Packet(rawValue);

            switch (typeId)
            {
                case 1:
                    return packet.readBoolean();

                case 2:
                case 31:
                    return packet.readInt32BE();

                case 3:
                case 37:
                    return packet.readUInt32BE();

                case 4:
                    return Number(packet.readInt64BE());

                case 5:
                    return Number(packet.readUInt64BE());

                case 6:
                    return packet.readDouble();

                case 10:
                    return packet.readStringUTF16();

                default:
                    return valueContents === "" ? rawValue.toString("hex") : valueContents;
            }
        }
        catch (_error)
        {
            return valueContents === "" ? rawValue.toString("hex") : valueContents;
        }
    }

    /** Group a decoded object subtree by context id for inspector presentation. */
    private collectObjectsByContext(objects : QmlDebugObjectReference[]) : QmlDebugContextNode[]
    {
        const contexts = new Map<number, QmlDebugContextNode>();
        const visit = (current : QmlDebugObjectReference) : void =>
        {
            const contextId = current.contextDebugId;
            if (!contexts.has(contextId))
                contexts.set(contextId, { debugId: contextId, objectIds: [] });

            const context = contexts.get(contextId)!;
            context.objectIds.push(current.debugId);

            for (const child of current.children)
                visit(child);
        };

        for (const current of objects)
            visit(current);

        return [ ...contexts.values() ].sort((left, right) : number => { return left.debugId - right.debugId; });
    }

    /** Decode a QmlDebugger object reference and, optionally, its subtree payload. */
    private decodeObjectReference(packet : Packet, simple : boolean) : QmlDebugObjectReference
    {
        const object = {
            debugId: packet.readInt32BE(),
            className: "",
            idString: "",
            name: "",
            source: {
                url: "",
                lineNumber: -1,
                columnNumber: -1
            },
            contextDebugId: -1,
            parentDebugId: -1,
            propertyCount: 0,
            properties: [],
            children: []
        } as QmlDebugObjectReference;

        object.source.url = packet.readByteArray().toString("latin1");
        object.source.lineNumber = packet.readInt32BE();
        object.source.columnNumber = packet.readInt32BE();
        object.idString = packet.readStringUTF16();
        object.name = packet.readStringUTF16();
        object.className = packet.readStringUTF16();
        object.debugId = packet.readInt32BE();
        object.contextDebugId = packet.readInt32BE();
        object.parentDebugId = packet.readInt32BE();

        if (simple)
            return object;

        const childCount = packet.readInt32BE();
        const recurse = packet.readBoolean();
        for (let index = 0; index < childCount; index++)
            object.children.push(this.decodeObjectReference(packet, !recurse));

        object.propertyCount = packet.readInt32BE();
        for (let index = 0; index < object.propertyCount; index++)
        {
            const typeId = packet.readInt32BE();
            const name = packet.readStringUTF16();
            const rawValue = packet.readByteArray();
            const valueTypeName = packet.readStringUTF16();
            const valueContents = packet.readStringUTF16();
            const hasNotifySignal = packet.readBoolean();

            object.properties.push(
                {
                    typeId: typeId,
                    name: name,
                    rawValue: rawValue.toString("hex"),
                    valueTypeName: valueTypeName,
                    valueContents: valueContents,
                    hasNotifySignal: hasNotifySignal,
                    decodedValue: this.decodePropertyValue(typeId, valueContents, rawValue)
                }
            );
        }

        return object;
    }

    /** Request a fully decoded object subtree for a single runtime object id. */
    public async requestObject(debugId : number) : Promise<QmlDebugObjectReference>
    {
        Log.trace("QmlDebugger.requestObject", [ debugId ]);

        const request = new Packet();
        request.appendInt32BE(debugId);
        request.appendBoolean(true);

        const packet = await this.makeRequest("FETCH_OBJECT", request);
        return this.decodeObjectReference(packet, false);
    }

    /** Materialize decoded object trees and context groupings for the requested ids. */
    public async requestObjectTreeSnapshot(objectIds : number[]) : Promise<QmlDebugObjectTreeSnapshot>
    {
        Log.trace("QmlDebugger.requestObjectTreeSnapshot", [ objectIds ]);

        const uniqueObjectIds = [ ...new Set(objectIds.filter((value) : boolean => { return value >= 0; })) ];
        const objects : QmlDebugObjectReference[] = [];

        for (const objectId of uniqueObjectIds)
            objects.push(await this.requestObject(objectId));

        return {
            selectedObjectIds: uniqueObjectIds,
            objects: objects,
            contexts: this.collectObjectsByContext(objects)
        };
    }

    public async requestObjectsForLocation(filename : string, lineNumber : number, columnNumber : number) : Promise<QmlDebugObjectReference[]>
    {
        Log.trace("QmlDebugger.requestObjectsForLocation", [ filename, lineNumber, columnNumber ]);

        const request = new Packet();
        request.appendStringUTF16(filename);
        request.appendInt32BE(lineNumber);
        request.appendInt32BE(columnNumber);
        request.appendBoolean(false);
        request.appendBoolean(false);

        const packet = await this.makeRequest("FETCH_OBJECTS_FOR_LOCATION", request);
        const count = packet.readInt32BE();
        const objects : QmlDebugObjectReference[] = [];

        for (let index = 0; index < count; index++)
            objects.push(this.decodeObjectReference(packet, false));

        return objects;
    }

    private packetReceived(packet : Packet)
    {
        Log.trace("ServiceQmlDebugger.packetReceived", [ packet ]);

        const operation = packet.readStringUTF8();
        const seqId = packet.readInt32BE();

        if (operation === "OBJECT_CREATED")
        {

        }
        else
        {
            for (let i = 0; i < this.awaitingRequests.length; i++)
            {
                const current = this.awaitingRequests[i];
                if (current.seqId === seqId)
                {
                    this.awaitingRequests.splice(i, 1);
                    clearTimeout(current.timerId);
                    current.resolve(packet);
                    return;
                }
            }

            Log.error("Packet with wrong sequence id received. Sequence Id: " + seqId + ", " + operation +  "Operation: ");
        }
    }

    protected nextSeqId() : number
    {
        this.seqId++;
        return this.seqId;
    }

    protected makeRequest(operation : string, data? : Packet) : Promise<Packet>
    {
        Log.trace("ServiceQmlDebugger.makeRequest", [ operation, data ]);

        return new Promise<Packet>(
            (resolve, reject) =>
            {
                const seqId = this.nextSeqId();
                const packet = new Packet();
                packet.appendStringUTF8(operation);
                packet.appendUInt32BE(seqId);
                if (data !== undefined)
                    packet.combine(data);

                const envelopPacket = new Packet();
                envelopPacket.appendStringUTF16("QmlDebugger");
                envelopPacket.appendSubPacket(packet);

                const timerId = setTimeout(
                    () =>
                    {
                        reject(new Error("Request timed out. Sequence Id: " + seqId));
                    },
                    10000
                );

                this.awaitingRequests.push(
                    {
                        seqId: seqId,
                        resolve: resolve,
                        reject: reject,
                        timerId: timerId
                    }
                );

                this.session!.packetManager!.writePacket(envelopPacket);
            }
        );
    }

    public async initialize() : Promise<void>
    {
        Log.trace("ServiceQmlDebugger.initialize", []);
    }

    public async deinitialize() : Promise<void>
    {
        Log.trace("ServiceQmlDebugger.deinitialize", []);
    }

    public constructor(session : QmlDebugSession)
    {
        Log.trace("ServiceQmlDebugger.constructor", [ session ]);

        this.session = session;
        this.session.packetManager.registerHandler("QmlDebugger",
            (header, packet) : boolean =>
            {
                const servicePacket = packet.readSubPacket();
                this.packetReceived(servicePacket);

                return true;
            }
        );
    }
}
