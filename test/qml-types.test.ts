import assert = require("assert");
import { isQmlBacktrace, isQmlVariable } from "@qml-debug/qml-types";
import { isQmlBreakEvent, isQmlEvaluateResponse, isQmlLookupRequest } from "@qml-debug/qml-messages";

describe("QML protocol type guards", () =>
{
    it("accepts valid variables and rejects malformed variables", () =>
    {
        assert.strictEqual(isQmlVariable({ handle: 1, type: "number", value: 10 }), true);
        assert.strictEqual(isQmlVariable({ handle: 1, type: "number" }), false);
        assert.strictEqual(isQmlVariable({ type: "object", value: 1, properties: [ { type: "string", value: "ok" } ] }), true);
        assert.strictEqual(isQmlVariable({ type: "object", value: 1, properties: [ { value: "missing type" } ] }), false);
    });

    it("accepts valid backtraces and rejects malformed frames", () =>
    {
        assert.strictEqual(isQmlBacktrace({ fromFrame: 0, toFrame: 1, frames: [ { index: 0, func: "main", script: "qrc:/main.qml", line: 5, debuggerFrame: false, scopes: [] } ] }), true);
        assert.strictEqual(isQmlBacktrace({ fromFrame: 0, toFrame: 1, frames: [ { index: 0, func: "main" } ] }), false);
    });

    it("checks lookup requests", () =>
    {
        assert.strictEqual(isQmlLookupRequest({ type: "request", seq: 1, command: "lookup", arguments: { handles: [ 1, 2 ] } }), true);
        assert.strictEqual(isQmlLookupRequest({ type: "request", seq: 1, command: "lookup", arguments: { handles: [ "bad" ] } }), false);
    });

    it("checks break events", () =>
    {
        assert.strictEqual(isQmlBreakEvent({ type: "event", seq: 1, event: "break", body: { breakpoints: [ 7 ], invocationText: "onClicked", script: { name: "main.qml" }, sourceLine: 10 } }), true);
        assert.strictEqual(isQmlBreakEvent({ type: "event", seq: 1, event: "break", body: { breakpoints: [ "bad" ], invocationText: "onClicked", script: { name: "main.qml" }, sourceLine: 10 } }), false);
    });

    it("checks evaluate responses", () =>
    {
        assert.strictEqual(isQmlEvaluateResponse({ type: "response", seq: 2, request_seq: 1, command: "evaluate", success: true, running: false, body: { handle: 3, type: "string", value: "ok" } }), true);
        assert.strictEqual(isQmlEvaluateResponse({ type: "response", seq: 2, request_seq: 1, command: "evaluate", success: true, running: false, body: { handle: 3, value: "missing type" } }), false);
    });
});
