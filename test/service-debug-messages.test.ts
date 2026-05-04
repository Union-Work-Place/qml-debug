import assert = require("assert");
import Packet from "@qml-debug/packet";
import ServiceDebugMessages from "@qml-debug/service-debug-messages";
import { DebugProtocol } from "@vscode/debugprotocol";

/** DebugMessages subclass that exposes packetReceived for tests. */
class TestServiceDebugMessages extends ServiceDebugMessages
{
    /** Invoke the protected packet receiver. */
    public emitPacket(packet : Packet) : void
    {
        this.packetReceived(packet);
    }
}

/** Create a Qt DebugMessages service packet. */
function makeMessagePacket(type : number, message : string) : Packet
{
    const packet = new Packet();
    packet.appendStringUTF8("MESSAGE");
    packet.appendInt32BE(type);
    packet.appendStringUTF8(message);
    packet.appendStringUTF8("qrc:/qml/Main.qml");
    packet.appendInt32BE(12);
    packet.appendStringUTF8("onClicked");
    packet.appendStringUTF8("qml");
    packet.appendInt64BE(BigInt(2000000000));
    return packet;
}

describe("ServiceDebugMessages", () =>
{
    it("maps Qt warnings to DAP stderr output with source metadata", () =>
    {
        const events : DebugProtocol.Event[] = [];
        const session =
        {
            packetManager:
            {
                registerHandler: () : void => undefined
            },
            mapPathFrom: (filename : string) : string => filename.replace("qrc:/qml", "/project/qml"),
            sendEvent: (event : DebugProtocol.Event) : void =>
            {
                events.push(event);
            }
        };
        const service = new TestServiceDebugMessages(session as any);

        service.emitPacket(makeMessagePacket(1, "Careful"));

        const outputEvent = events[0] as DebugProtocol.OutputEvent;
        assert.strictEqual(outputEvent.body.category, "stderr");
        assert.strictEqual(outputEvent.body.output, "Warning:  Careful\n");
        assert.strictEqual(outputEvent.body.source!.path, "/project/qml/Main.qml");
        assert.strictEqual(outputEvent.body.line, 12);
        assert.deepStrictEqual(outputEvent.body.data,
            {
                type: "Warning",
                timestamp: 2,
                source: "/project/qml/Main.qml",
                line: 12,
                category: "qml",
                functionName: "onClicked",
                message: "Careful"
            }
        );
    });
});
