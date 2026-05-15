import assert = require("assert");
import ServiceQmlProfiler from "@qml-debug/services/qml-profiler";

/** Decode a profiler packet through the service's semantic timeline mapper. */
function decode(rawPacket : Buffer) : any
{
    const service = Object.create(ServiceQmlProfiler.prototype) as any;
    return service.decodeTimelineEvent(rawPacket, "2026-05-15T00:00:00.000Z");
}

describe("ServiceQmlProfiler", () =>
{
    it("adds semantic timeline metadata to primitive profiler packets", () =>
    {
        const timestamp = decode(Buffer.from("0000000000000008", "hex"));
        assert.strictEqual(timestamp.kind, "uint64");
        assert.strictEqual(timestamp.category, "scene-graph");
        assert.strictEqual(timestamp.label, "frame-timestamp");
        assert.strictEqual(timestamp.valueUnit, "microseconds");
        assert.strictEqual(timestamp.decodedValue, 8);

        const recordingState = decode(Buffer.from([ 1 ]));
        assert.strictEqual(recordingState.kind, "boolean");
        assert.strictEqual(recordingState.category, "control");
        assert.strictEqual(recordingState.label, "recording-enabled");
    });
});