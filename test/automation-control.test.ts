import assert = require("assert");
import { QmlAutomationController, QmlAutomationEnvironment, QmlAutomationSourceBreakpoint, coerceAutomationRunRequest, describeAutomationControl } from "@qml-debug/extension/automation-control";

/** Create a lightweight debug session for automation tests. */
function debugSession(id : string, name : string = "QML") : any
{
    return {
        id: id,
        name: name,
        type: "qml",
        customRequests: [] as { command : string; args : any }[],
        customRequest: async function(command : string, args : any) : Promise<any>
        {
            this.customRequests.push({ command: command, args: args });
            if (command === "qml/getCapabilities")
                return { inspectorAvailable: true, profilerAvailable: true };

            if (command === "evaluate")
                return { result: "42", variablesReference: 0 };

            return { command: command, args: args };
        }
    };
}

/** Build an injectable automation environment. */
function createEnvironment(sessions : any[] = [], activeSession : any = undefined) : QmlAutomationEnvironment & { started : any[]; stopped : any[]; breakpointCalls : any[] }
{
    const environment = {
        started: [] as any[],
        stopped: [] as any[],
        breakpointCalls: [] as any[],
        getActiveDebugSession: () : any => activeSession,
        getDebugSessions: () : readonly any[] => sessions,
        startDebugging: async (_folder : any, configuration : any) : Promise<boolean> =>
        {
            environment.started.push(configuration);
            return true;
        },
        stopDebugging: async (session? : any) : Promise<void> =>
        {
            environment.stopped.push(session);
        },
        setSourceBreakpoints: async (sourcePath : string, breakpoints : QmlAutomationSourceBreakpoint[], replace : boolean) : Promise<any> =>
        {
            environment.breakpointCalls.push({ sourcePath: sourcePath, breakpoints: breakpoints, replace: replace });
            return { path: sourcePath, breakpoints: breakpoints, replaced: replace };
        }
    };

    return environment;
}

describe("automation control", () =>
{
    it("describes stable actions and error codes", () =>
    {
        const description = describeAutomationControl();

        assert.strictEqual(description.schemaVersion, 1);
        assert.strictEqual(description.actions.some((action) : boolean => { return action.action === "debug.launch"; }), true);
        assert.strictEqual(description.actions.some((action) : boolean => { return action.action === "dap.evaluate"; }), true);
        assert.strictEqual(description.actions.some((action) : boolean => { return action.action === "profiler.export"; }), true);
        assert.strictEqual(description.errors.includes("NoQmlSession"), true);
    });

    it("coerces command shorthand into an automation request", () =>
    {
        assert.deepStrictEqual(coerceAutomationRunRequest("dap.evaluate", { expression: "answer" }), { action: "dap.evaluate", args: { expression: "answer" } });
    });

    it("lists live sessions and chooses the active QML session", async () =>
    {
        const first = debugSession("first", "First");
        const second = debugSession("second", "Second");
        const environment = createEnvironment([ first, second ], second);
        const controller = new QmlAutomationController(environment);

        const response = await controller.run({ action: "sessions" });

        if (!response.ok)
            assert.fail(response.error.message);

        assert.strictEqual(response.body.activeSessionId, "second");
        assert.strictEqual(response.body.preferredSessionId, "second");
        assert.deepStrictEqual(response.body.sessions.map((session : any) : string => { return session.id; }), [ "first", "second" ]);
    });

    it("runs DAP requests against a selected session", async () =>
    {
        const first = debugSession("first");
        const second = debugSession("second");
        const environment = createEnvironment([ first, second ], first);
        const controller = new QmlAutomationController(environment);

        const response = await controller.run({ action: "dap.evaluate", sessionId: "second", args: { expression: "2 + 2", frameId: 1 } });

        if (!response.ok)
            assert.fail(response.error.message);

        assert.strictEqual(response.sessionId, "second");
        assert.deepStrictEqual(second.customRequests, [ { command: "evaluate", args: { expression: "2 + 2", frameId: 1 } } ]);
    });

    it("returns deterministic errors when no QML session is available", async () =>
    {
        const environment = createEnvironment([], undefined);
        const controller = new QmlAutomationController(environment);

        const response = await controller.run({ action: "profiler.export" });

        if (response.ok)
            assert.fail("Expected profiler.export to fail without a QML session.");

        assert.strictEqual(response.error.code, "NoQmlSession");
    });

    it("starts launch and attach sessions through VS Code debug configurations", async () =>
    {
        const environment = createEnvironment([], undefined);
        const controller = new QmlAutomationController(environment);

        const launch = await controller.run({ action: "debug.launch", args: { configuration: { name: "Launch", program: "/app" } } });
        const attach = await controller.run({ action: "debug.attach", args: { configuration: { name: "Attach", host: "localhost", port: 12150 } } });

        if (!launch.ok)
            assert.fail(launch.error.message);
        if (!attach.ok)
            assert.fail(attach.error.message);

        assert.deepStrictEqual(environment.started.map((configuration : any) : string => { return configuration.request; }), [ "launch", "attach" ]);
        assert.deepStrictEqual(environment.started.map((configuration : any) : string => { return configuration.type; }), [ "qml", "qml" ]);
    });

    it("sets source breakpoints through the automation boundary", async () =>
    {
        const environment = createEnvironment([], undefined);
        const controller = new QmlAutomationController(environment);

        const response = await controller.run(
            {
                action: "breakpoints.setSource",
                args: {
                    path: "/workspace/Main.qml",
                    replace: true,
                    breakpoints: [ { line: 12, column: 3, condition: "ready" } ]
                }
            }
        );

        if (!response.ok)
            assert.fail(response.error.message);

        assert.deepStrictEqual(environment.breakpointCalls[0],
            {
                sourcePath: "/workspace/Main.qml",
                replace: true,
                breakpoints: [ { line: 12, column: 3, condition: "ready", hitCondition: undefined, logMessage: undefined } ]
            }
        );
    });
});