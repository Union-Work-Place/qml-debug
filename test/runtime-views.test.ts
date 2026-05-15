import assert = require("assert");
import { QmlRuntimeSessionTracker, shouldPollRuntimeViews } from "@qml-debug/extension/runtime-views";

/** Build a lightweight debug session value for runtime-view tests. */
function debugSession(id : string, type : string = "qml") : any
{
    return {
        id: id,
        type: type,
        customRequest: async () : Promise<undefined> => undefined
    };
}

describe("runtime views", () =>
{
    it("prefers the active QML session and falls back to the last focused live session", () =>
    {
        const tracker = new QmlRuntimeSessionTracker();
        const first = debugSession("first");
        const second = debugSession("second");

        tracker.onSessionStarted(first);
        tracker.onSessionStarted(second);
        tracker.onActiveSessionChanged(first);

        assert.strictEqual(tracker.getPreferredSession(undefined)?.id, "first");
        assert.strictEqual(tracker.getPreferredSession(second)?.id, "second");
        assert.strictEqual(tracker.getPreferredSession(undefined)?.id, "second");
    });

    it("falls back to another live QML session when the last focused one terminates", () =>
    {
        const tracker = new QmlRuntimeSessionTracker();
        const first = debugSession("first");
        const second = debugSession("second");

        tracker.onSessionStarted(first);
        tracker.onSessionStarted(second);
        tracker.onActiveSessionChanged(second);
        tracker.onSessionTerminated(second);

        assert.strictEqual(tracker.getPreferredSession(undefined)?.id, "first");
    });

    it("ignores non-QML sessions when choosing the runtime-view fallback session", () =>
    {
        const tracker = new QmlRuntimeSessionTracker();
        const qmlSession = debugSession("qml-session");
        const nodeSession = debugSession("node-session", "node");

        tracker.onSessionStarted(qmlSession);
        tracker.onActiveSessionChanged(nodeSession);

        assert.strictEqual(tracker.getPreferredSession(nodeSession)?.id, "qml-session");
    });

    it("enables polling only while inspector or profiler state is actively changing", () =>
    {
        assert.strictEqual(shouldPollRuntimeViews(undefined, undefined), false);
        assert.strictEqual(shouldPollRuntimeViews({ enabled: true, showAppOnTop: false, currentObjectIds: [], pendingRequestCount: 0, available: true }, undefined), true);
        assert.strictEqual(shouldPollRuntimeViews({ enabled: false, showAppOnTop: false, currentObjectIds: [], pendingRequestCount: 1, available: true }, undefined), true);
        assert.strictEqual(shouldPollRuntimeViews({ enabled: false, showAppOnTop: false, currentObjectIds: [], pendingRequestCount: 0, available: true }, { available: true, recording: true, requestedFeatureMask: "0", requestedFeatures: [], flushInterval: 250, packetCount: 0, receivedBytes: 0, recentPackets: [], timelineEvents: [] }), true);
        assert.strictEqual(shouldPollRuntimeViews({ enabled: false, showAppOnTop: false, currentObjectIds: [], pendingRequestCount: 0, available: true }, { available: true, recording: false, requestedFeatureMask: "0", requestedFeatures: [], flushInterval: 250, packetCount: 0, receivedBytes: 0, recentPackets: [], timelineEvents: [] }), false);
    });
});
