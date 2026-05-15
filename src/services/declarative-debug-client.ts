import Log from "@qml-debug/common/log";
import Packet from "@qml-debug/transport/packet";
import { QmlDebugSession } from "@qml-debug/adapter/debug-adapter";


/** One Qt debug service announced during the declarative handshake. */
export interface NegotiatedQtDebugService
{
    /** Service name, for example `QmlDebugger` or `V8Debugger`. */
    name : string;
    /** Service version reported by the Qt runtime. */
    version : number;
}

/** Snapshot of the declarative handshake capabilities negotiated with Qt. */
export interface NegotiatedQtDebugCapabilities
{
    /** Protocol version reported by the server. */
    protocolVersion : number;
    /** QDataStream version reported by the server. */
    dataStreamVersion : number;
    /** Services announced by the runtime. */
    services : NegotiatedQtDebugService[];
}


/** Service wrapper responsible for the initial Qt declarative handshake. */
export default class ServiceDeclarativeDebugClient
{
    /** Owning debug session used for transport access. */
    private session? : QmlDebugSession;
    /** Promise resolver for the active handshake, if any. */
    private handshakeResolve? : () => void;
    /** Promise reject callback for the active handshake, if any. */
    private handshakeReject? : (error : Error) => void;
    /** Timeout guard for the active handshake. */
    private handshakeResolveTimeout? : NodeJS.Timeout;
    /** Last negotiated capability snapshot. */
    private capabilities : NegotiatedQtDebugCapabilities = {
        protocolVersion: 0,
        dataStreamVersion: 0,
        services: []
    };

    /** Return true while a declarative handshake is in progress. */
    private isHandshakePending() : boolean
    {
        return this.handshakeResolve !== undefined || this.handshakeReject !== undefined;
    }

    /** Reset the negotiated capability snapshot to an empty state. */
    private resetCapabilities() : void
    {
        this.capabilities = {
            protocolVersion: 0,
            dataStreamVersion: 0,
            services: []
        };
    }

    /** Resolve the active handshake and clear its timeout bookkeeping. */
    private resolveHandshake() : void
    {
        if (this.handshakeResolveTimeout !== undefined)
        {
            clearTimeout(this.handshakeResolveTimeout);
            this.handshakeResolveTimeout = undefined;
        }

        const resolve = this.handshakeResolve;
        this.handshakeResolve = undefined;
        this.handshakeReject = undefined;
        resolve?.();
    }

    /** Reject the active handshake and optionally close the underlying transport. */
    private failHandshake(error : Error, disconnectTransport : boolean = false) : void
    {
        if (this.handshakeResolveTimeout !== undefined)
        {
            clearTimeout(this.handshakeResolveTimeout);
            this.handshakeResolveTimeout = undefined;
        }

        const reject = this.handshakeReject;
        this.handshakeResolve = undefined;
        this.handshakeReject = undefined;
        reject?.(error);

        if (disconnectTransport)
            this.session?.packetManager?.disconnect().catch(() : void => undefined);
    }

    /** Throw when a required Qt debug service is missing from the handshake response. */
    private ensureRequiredServices(services : NegotiatedQtDebugService[]) : void
    {
        const requiredServices = [ "V8Debugger", "QmlDebugger" ];
        const missingServices = requiredServices.filter((name) : boolean =>
        {
            return !services.some((service) : boolean => { return service.name === name; });
        });

        if (missingServices.length > 0)
        {
            throw new Error("Required debugger service" + (missingServices.length > 1 ? "s" : "") + " not found on debug server. Service Name" + (missingServices.length > 1 ? "s" : "") + ": " + missingServices.join(", "));
        }
    }

    /** Decode the declarative handshake response and update local capabilities. */
    private packetReceived(packet: Packet): void
    {
        Log.trace("ServiceDeclarativeDebugClient.packetReceived", []);

        try
        {
            const op = packet.readInt32BE();
            if (op !== 0)
                throw new Error("Unknown QDeclarativeDebugClient operation. Received Operation: " + op);

            const protocolVersion = packet.readUInt32BE();
            const plugins = packet.readArray(Packet.prototype.readStringUTF16);
            const pluginVersions = packet.readArray(Packet.prototype.readDouble);
            const datastreamVersion = packet.readUInt32BE();

            if (plugins.length !== pluginVersions.length)
                throw new Error("Malformed QDeclarativeDebugClient handshake response. Plugin and version counts do not match.");

            const services = plugins.map<NegotiatedQtDebugService>((plugin, index) =>
            {
                return {
                    name: plugin,
                    version: pluginVersions[index]
                };
            });

            this.ensureRequiredServices(services);
            this.capabilities = {
                protocolVersion: protocolVersion,
                dataStreamVersion: datastreamVersion,
                services: services
            };

            Log.detail(
                () =>
                {
                    let output = "QDeclarativeDebugClient Server:\n" +
                    "  Protocol Version: " + protocolVersion + "\n" +
                    "  Datastream Version: " + datastreamVersion + "\n" +
                    "  Plugin Count: " + plugins.length;
                    if (plugins.length > 0)
                    {
                        output += "\n  Plugins:";
                        for (let i = 0; i < plugins.length; i++)
                            output += "\n    " + plugins[i] + ": " + pluginVersions[i];
                    }

                    return output;
                }
            );

            if (protocolVersion !== 1)
                Log.warning("Unknwon protocol version. Received Protocol Version: " + protocolVersion);

            if (datastreamVersion !== 12)
                Log.warning("Unknown data stream version. Received Data Stream Version: " + datastreamVersion);

            const debugMessagesFound = services.some((service) : boolean => { return service.name === "DebugMessages"; });
            if (!debugMessagesFound)
            {
                Log.warning("Supported but optional debugger service not found on debug server. Service Name: DebugMessage");
                Log.info("You can enable optional debug services by enabling them in -qmljsdebugger command line arguments. For example; ./your-application -qmljsdebugger=host:localhost,port:10222,services:DebugMessages,QmlDebugger,V8Debugger");
            }

            this.resolveHandshake();
        }
        catch (error)
        {
            this.resetCapabilities();

            const handshakeError = error instanceof Error ? error : new Error(String(error));
            Log.error(handshakeError.message);

            if (!this.isHandshakePending())
                return;

            this.failHandshake(handshakeError, true);
        }
    }

    /** Return a defensive copy of the last negotiated capability snapshot. */
    public getCapabilities() : NegotiatedQtDebugCapabilities
    {
        return {
            protocolVersion: this.capabilities.protocolVersion,
            dataStreamVersion: this.capabilities.dataStreamVersion,
            services: this.capabilities.services.map<NegotiatedQtDebugService>((service) =>
            {
                return {
                    name: service.name,
                    version: service.version
                };
            })
        };
    }

    /** Return true when the negotiated service list contains the requested name. */
    public isServiceAvailable(name : string) : boolean
    {
        return this.capabilities.services.some((service) : boolean => { return service.name === name; });
    }

    /** Perform the declarative debug handshake with the Qt runtime. */
    public async handshake() : Promise<void>
    {
        Log.trace("ServiceDeclarativeDebugClient.handshake", []);

        const packet = new Packet();
        packet.appendStringUTF16("QDeclarativeDebugServer");
        packet.appendInt32BE(0); // OP
        packet.appendInt32BE(1); // Version
        packet.appendArray(Packet.prototype.appendStringUTF16, // Client Plugins
            [
                "V8Debugger",
                "QmlDebugger",
                "DebugMessages",
                "QmlInspector"
            ]
        );
        packet.appendInt32BE(12); // Stream Version (Qt 4.7)
        packet.appendBoolean(true); // MultiPacket Support

        await new Promise<void>((resolve, reject) =>
        {
            this.handshakeResolve = resolve;
            this.handshakeReject = reject;
            this.handshakeResolveTimeout = setTimeout(
                () =>
                {
                    this.failHandshake(new Error("Handshake with QDeclarativeDebugging Service has been timed out."));
                },
                1000
            );

            this.session!.packetManager?.writePacket(packet).catch((error) =>
            {
                this.failHandshake(error instanceof Error ? error : new Error(String(error)));
            });
        });
    }

    /** Reset capability state before a connection starts. */
    public async initialize(): Promise<void>
    {
        Log.trace("ServiceDeclarativeDebugClient.initialize", []);

        this.failHandshake(new Error("QDeclarativeDebugClient service reinitialized."));
        this.resetCapabilities();

    }

    /** Clear capability state after a connection ends. */
    public async deinitialize() : Promise<void>
    {
        Log.trace("ServiceDeclarativeDebugClient.deinitialize", []);

        this.failHandshake(new Error("QDeclarativeDebugClient service disconnected."));
        this.resetCapabilities();

    }

    /** Register the declarative debug packet handler on the shared transport. */
    public constructor(session : QmlDebugSession)
    {
        Log.trace("ServiceDeclarativeDebugClient.constructor", [ session ]);

        this.session = session;
        this.session.packetManager.registerTransportCloseHandler((error : Error) : void =>
        {
            if (!this.isHandshakePending())
                return;

            this.failHandshake(new Error("QDeclarativeDebugClient transport closed. " + error.message));
        });
        this.session.packetManager.registerHandler("QDeclarativeDebugClient",
            (header, packet) : boolean =>
            {
                this.packetReceived(packet);
                return true;
            }
        );
    }
}
