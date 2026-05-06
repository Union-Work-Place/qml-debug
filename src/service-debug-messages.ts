import { OutputEvent } from "@vscode/debugadapter";
import Log from "@qml-debug/log";
import Packet from "@qml-debug/packet";

import { QmlDebugSession } from "@qml-debug/debug-adapter";
import { DebugProtocol } from "@vscode/debugprotocol";


/** Service wrapper for the optional Qt DebugMessages stream. */
export default class ServiceDebugMessages
{
    /** Owning debug session used to emit DAP output events. */
    private session? : QmlDebugSession;

    /** Convert a Qt message type id into a display label and DAP output category. */
    private convertMessageType(type : number) : { label : string; category : "stdout" | "stderr" | "console" }
    {
        switch (type)
        {
            case 0:
                return { label: "Debug", category: "stdout" };

            case 1:
                return { label: "Warning", category: "stderr" };

            case 2:
                return { label: "Critical", category: "stderr" };

            case 3:
                return { label: "Fatal", category: "stderr" };

            case 4:
                return { label: "Info", category: "stdout" };

            default:
                return { label: "Unknown", category: "console" };
        }
    }

    /** Decode one DebugMessages packet and forward it as a DAP OutputEvent. */
    protected packetReceived(packet: Packet): void
    {
        Log.trace("ServiceDebugMessages.packetReceived", [ packet ]);

        const messageHeader = packet.readStringUTF8();
        if (messageHeader !== "MESSAGE")
            return;

        const type = packet.readInt32BE();
        const message = packet.readStringUTF8();
        const filename = packet.readStringUTF8();
        const line = packet.readInt32BE();
        const functionName = packet.readStringUTF8();
        const category = packet.readStringUTF8();
        const elapsedSeconds = Number(packet.readInt64BE() / BigInt(1000000000));

        const typeInfo = this.convertMessageType(type);
        const sourcePath = this.session?.mapPathFrom(filename) ?? filename;

        const outputEvent : DebugProtocol.OutputEvent = new OutputEvent(typeInfo.label + ":  " + message + "\n", typeInfo.category);
        outputEvent.body.source =
        {
            path: sourcePath,
        };
        outputEvent.body.line = line;
        outputEvent.body.data =
        {
            type: typeInfo.label,
            timestamp: elapsedSeconds,
            source: sourcePath,
            line: line,
            category: category,
            functionName: functionName,
            message: message
        };

        this.session?.sendEvent(outputEvent);
    }

    /** Open a grouped output section when DebugMessages becomes active. */
    public async initialize() : Promise<void>
    {
        Log.trace("ServiceDebugMessages.initialize", []);

        const outputGroupEvent : DebugProtocol.OutputEvent = new OutputEvent("QML Debug Output", "console");
        outputGroupEvent.body.group = "start";
        this.session?.sendEvent(outputGroupEvent);
    }

    /** Close the grouped output section when DebugMessages shuts down. */
    public async deinitialize() : Promise<void>
    {
        Log.trace("ServiceDebugMessages.deinitialize", []);

        const outputGroupEvent : DebugProtocol.OutputEvent = new OutputEvent("QML Debug Output", "console");
        outputGroupEvent.body.group = "end";
        this.session?.sendEvent(outputGroupEvent);
    }

    /** Register the DebugMessages packet handler on the shared transport. */
    public constructor(session : QmlDebugSession)
    {
        Log.trace("ServiceDebugMessages.constructor", [ session ]);

        this.session = session;
        this.session.packetManager.registerHandler("DebugMessages",
            (header, packet) : boolean =>
            {
                const servicePacket = packet.readSubPacket();
                this.packetReceived(servicePacket);

                return true;
            }
        );
    }
}
