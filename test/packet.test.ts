import assert = require("assert");
import Packet from "@qml-debug/packet";

describe("Packet", () =>
{
    it("round-trips primitive values", () =>
    {
        const packet = new Packet();
        packet.appendUInt8(0x12);
        packet.appendUInt16BE(0x3456);
        packet.appendUInt32LE(0x78563412);
        packet.appendInt32BE(-42);
        packet.appendBoolean(true);
        packet.appendFloat(1.5);
        packet.appendDouble(2.25);

        assert.strictEqual(packet.readUInt8(), 0x12);
        assert.strictEqual(packet.readUInt16BE(), 0x3456);
        assert.strictEqual(packet.readUInt32LE(), 0x78563412);
        assert.strictEqual(packet.readInt32BE(), -42);
        assert.strictEqual(packet.readBoolean(), true);
        assert.strictEqual(packet.readFloat(), 1.5);
        assert.strictEqual(packet.readDouble(), 2.25);
        assert.strictEqual(packet.readEOF(), true);
    });

    it("round-trips utf strings, arrays, json and sub-packets", () =>
    {
        const child = new Packet();
        child.appendStringUTF8("child");

        const packet = new Packet();
        packet.appendStringUTF8("hello");
        packet.appendStringUTF16("qml");
        packet.appendArray(Packet.prototype.appendStringUTF8, [ "a", "b" ]);
        packet.appendJsonUTF8({ value: 42 });
        packet.appendSubPacket(child);

        assert.strictEqual(packet.readStringUTF8(), "hello");
        assert.strictEqual(packet.readStringUTF16(), "qml");
        assert.deepStrictEqual(packet.readArray(Packet.prototype.readStringUTF8), [ "a", "b" ]);
        assert.deepStrictEqual(packet.readJsonUTF8(), { value: 42 });
        assert.strictEqual(packet.readSubPacket().readStringUTF8(), "child");
        assert.strictEqual(packet.readEOF(), true);
    });

    it("clamps read seek to the packet bounds", () =>
    {
        const packet = new Packet();
        packet.appendUInt8(1);

        packet.readSeek(-10);
        assert.strictEqual(packet.readTell(), 0);

        packet.readSeek(100);
        assert.strictEqual(packet.readTell(), packet.getSize());
        assert.strictEqual(packet.readEOF(), true);
    });
});
