import assert = require("assert");
import PacketManager from "@qml-debug/packet-manager";
import Packet from "@qml-debug/packet";

/** Build one framed packet as it appears on the Qt debug transport. */
function makeFrame(header : string, payload? : Packet) : Buffer
{
    const packet = new Packet();
    packet.appendStringUTF16(header);
    if (payload !== undefined)
        packet.combine(payload);

    const frame = Buffer.alloc(packet.getSize() + 4);
    frame.writeUInt32LE(packet.getSize() + 4, 0);
    packet.getData().copy(frame, 4);
    return frame;
}

describe("PacketManager", () =>
{
    it("dispatches a complete packet by header", () =>
    {
        const manager = new PacketManager({} as any);
        const payload = new Packet();
        payload.appendStringUTF8("ok");

        let value = "";
        manager.registerHandler("DebugMessages", (header, packet) =>
        {
            value = header + ":" + packet.readStringUTF8();
            return true;
        });

        manager.receivePacket(makeFrame("DebugMessages", payload));

        assert.strictEqual(value, "DebugMessages:ok");
    });

    it("buffers fragmented packets", () =>
    {
        const manager = new PacketManager({} as any);
        const payload = new Packet();
        payload.appendStringUTF8("fragmented");

        let value = "";
        manager.registerHandler("QmlDebugger", (header, packet) =>
        {
            value = packet.readStringUTF8();
            return true;
        });

        const frame = makeFrame("QmlDebugger", payload);
        manager.receivePacket(frame.slice(0, 3));
        assert.strictEqual(value, "");

        manager.receivePacket(frame.slice(3));
        assert.strictEqual(value, "fragmented");
    });

    it("dispatches multiple packets from one buffer", () =>
    {
        const manager = new PacketManager({} as any);
        const first = new Packet();
        const second = new Packet();
        first.appendStringUTF8("one");
        second.appendStringUTF8("two");

        const values : string[] = [];
        manager.registerHandler("V8Debugger", (header, packet) =>
        {
            values.push(packet.readStringUTF8());
            return true;
        });

        manager.receivePacket(Buffer.concat([ makeFrame("V8Debugger", first), makeFrame("V8Debugger", second) ]));

        assert.deepStrictEqual(values, [ "one", "two" ]);
    });

    it("supports wildcard handlers", () =>
    {
        const manager = new PacketManager({} as any);
        let dispatchedHeader = "";

        manager.registerHandler("*", (header) =>
        {
            dispatchedHeader = header;
            return true;
        });

        manager.receivePacket(makeFrame("UnknownService"));

        assert.strictEqual(dispatchedHeader, "UnknownService");
    });

    it("rejects invalid frame sizes", () =>
    {
        const manager = new PacketManager({} as any);
        const invalidFrame = Buffer.alloc(4);
        invalidFrame.writeUInt32LE(3, 0);

        assert.throws(() =>
        {
            manager.receivePacket(invalidFrame);
        }, /Invalid packet size/);
    });
});
