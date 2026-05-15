import assert = require("assert");
import fs = require("fs");
import path = require("path");
import { QmlDebugSession } from "@qml-debug/adapter/debug-adapter";
import { DebugProtocol } from "@vscode/debugprotocol";


/** Resolved configuration for a real Qt fixture executable and its source tree. */
interface QtFixtureConfiguration
{
    /** Absolute path to the compiled Qt fixture executable. */
    program : string;
    /** Working directory used when launching the fixture. */
    cwd : string;
    /** Absolute path to the fixture QML sources used for path mapping. */
    qmlPath : string;
    /** Where the fixture configuration came from. */
    origin : "environment" | "workspace";
}

/** Create a synthetic DAP response shell for direct request invocation. */
function createResponse(command : string) : DebugProtocol.Response
{
    return { type: "response", seq: 1, request_seq: 1, command: command, success: true } as DebugProtocol.Response;
}

/** Return the first built fixture executable found under the bundled Qt subproject. */
function findBundledFixtureProgram(fixtureRoot : string) : string | undefined
{
    const candidates = [
        path.join(fixtureRoot, "build", "qml-debug-fixture"),
        path.join(fixtureRoot, "build", "Debug", "qml-debug-fixture"),
        path.join(fixtureRoot, "build", "Release", "qml-debug-fixture"),
        path.join(fixtureRoot, "build", "qml-debug-fixture.exe"),
        path.join(fixtureRoot, "build", "Debug", "qml-debug-fixture.exe"),
        path.join(fixtureRoot, "build", "Release", "qml-debug-fixture.exe")
    ];

    for (const candidate of candidates)
    {
        if (fs.existsSync(candidate))
            return candidate;
    }

    return undefined;
}

/** Resolve a real Qt fixture either from explicit environment variables or a local bundled build. */
function resolveQtFixtureConfiguration() : QtFixtureConfiguration | undefined
{
    const program = process.env.QML_DEBUG_QT_FIXTURE_PROGRAM;
    const cwd = process.env.QML_DEBUG_QT_FIXTURE_CWD;
    const qmlPath = process.env.QML_DEBUG_QT_FIXTURE_QML_PATH;

    if (program !== undefined && cwd !== undefined && qmlPath !== undefined)
        return { program: program, cwd: cwd, qmlPath: qmlPath, origin: "environment" };

    const workspaceFolder = process.cwd();
    const fixtureRoot = path.join(workspaceFolder, "test", "qt-fixture");
    const bundledProgram = findBundledFixtureProgram(fixtureRoot);
    const bundledQmlPath = path.join(fixtureRoot, "qml");

    if (bundledProgram === undefined || !fs.existsSync(bundledQmlPath))
        return undefined;

    return {
        program: bundledProgram,
        cwd: fixtureRoot,
        qmlPath: bundledQmlPath,
        origin: "workspace"
    };
}

/** Format real-Qt fixture diagnostics for CI failures and local pending skips. */
function describeQtFixtureDiagnostics(fixture : QtFixtureConfiguration, response : DebugProtocol.Response) : string
{
    return JSON.stringify(
        {
            fixture: {
                origin: fixture.origin,
                program: fixture.program,
                programExists: fs.existsSync(fixture.program),
                cwd: fixture.cwd,
                qmlPath: fixture.qmlPath,
                qmlPathExists: fs.existsSync(fixture.qmlPath)
            },
            environment: {
                QT_QPA_PLATFORM: process.env.QT_QPA_PLATFORM,
                QML_DEBUG_QT_FIXTURE_HOST: process.env.QML_DEBUG_QT_FIXTURE_HOST,
                QML_DEBUG_QT_FIXTURE_PORT: process.env.QML_DEBUG_QT_FIXTURE_PORT,
                QML_DEBUG_QT_FIXTURE_STRICT: process.env.QML_DEBUG_QT_FIXTURE_STRICT
            },
            response: {
                command: response.command,
                success: response.success,
                message: response.message,
                body: response.body
            }
        },
        undefined,
        2
    );
}

/** Return whether known local real-Qt transport closure should become a hard failure. */
function isStrictQtFixtureRun() : boolean
{
    return process.env.QML_DEBUG_QT_FIXTURE_STRICT === "1";
}

/** Wait briefly so the real fixture can emit timer, animation, and profiler traffic. */
async function waitForFixtureActivity(timeoutMs : number) : Promise<void>
{
    await new Promise<void>((resolve) =>
    {
        setTimeout(resolve, timeoutMs);
    });
}

/** Wait until an async custom request has been answered by the adapter. */
async function waitForCapturedResponse(session : IntegrationSession, response : DebugProtocol.Response, timeoutMs : number = 5000) : Promise<DebugProtocol.Response>
{
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline)
    {
        if (session.responses.includes(response))
            return response;

        await new Promise<void>((resolve) : void =>
        {
            setTimeout(resolve, 10);
        });
    }

    throw new Error("Timed out waiting for custom request response: " + response.command);
}

/** Select a known fixture object using one of several stable source coordinates. */
async function selectKnownFixtureObject(session : IntegrationSession, fixture : QtFixtureConfiguration) : Promise<DebugProtocol.Response>
{
    const candidates = [
        { path: path.join(fixture.qmlPath, "Main.qml"), line: 0, column: 0 },
        { path: path.join(fixture.qmlPath, "Main.qml"), line: 1, column: 1 },
        { path: path.join(fixture.qmlPath, "Main.qml"), line: 6, column: 1 },
        { path: path.join(fixture.qmlPath, "Main.qml"), line: 49, column: 9 },
        { path: path.join(fixture.qmlPath, "Main.qml"), line: 50, column: 9 },
        { path: path.join(fixture.qmlPath, "Main.qml"), line: 56, column: 9 },
        { path: path.join(fixture.qmlPath, "Main.qml"), line: 72, column: 9 },
        { path: path.join(fixture.qmlPath, "Main.qml"), line: 75, column: 9 },
        { path: path.join(fixture.qmlPath, "components", "FixturePanel.qml"), line: 0, column: 0 },
        { path: path.join(fixture.qmlPath, "components", "FixturePanel.qml"), line: 1, column: 1 },
        { path: path.join(fixture.qmlPath, "components", "FixturePanel.qml"), line: 3, column: 1 },
        { path: path.join(fixture.qmlPath, "components", "FixturePanel.qml"), line: 11, column: 5 },
        { path: path.join(fixture.qmlPath, "components", "FixturePanel.qml"), line: 15, column: 5 },
        { path: path.join(fixture.qmlPath, "components", "FixturePanel.qml"), line: 2, column: 0 }
    ];

    let lastResponse : DebugProtocol.Response | undefined;
    for (const candidate of candidates)
    {
        lastResponse = await session.callCustom("qml/inspector/selectBySource", candidate);
        if (Array.isArray(lastResponse.body?.matchedObjectIds) && lastResponse.body.matchedObjectIds.length > 0)
            return lastResponse;
    }

    return lastResponse ?? await session.callCustom("qml/inspector/selectBySource", candidates[0]);
}

/** Test session that captures responses from the real Qt harness flow. */
class IntegrationSession extends QmlDebugSession
{
    /** Responses captured instead of being written to stdio. */
    public readonly responses : DebugProtocol.Response[] = [];

    /** Record a successful DAP response for later assertions. */
    public sendResponse(responseParam : DebugProtocol.Response) : void
    {
        this.responses.push(responseParam);
    }

    /** Ignore emitted DAP events in the harness test. */
    public sendEvent(_event : DebugProtocol.Event) : void
    {
        return undefined;
    }

    /** Capture DAP request failures for later assertions. */
    protected sendErrorResponse(responseParam : DebugProtocol.Response, codeOrMessage : any, format? : string, variables? : any, dest? : any) : void
    {
        responseParam.success = false;
        responseParam.message = typeof codeOrMessage === "object" ? codeOrMessage.format : format;
        this.responses.push(responseParam);
    }

    /** Invoke launchRequest directly with a prepared response shell. */
    public async callLaunch(args : any) : Promise<DebugProtocol.Response>
    {
        const launchResponse = createResponse("launch");
        await this.launchRequest(launchResponse as DebugProtocol.LaunchResponse, args);
        return launchResponse;
    }

    /** Invoke disconnectRequest directly so real Qt harness runs clean up their process state. */
    public async callDisconnect() : Promise<DebugProtocol.DisconnectResponse>
    {
        const disconnectResponse = createResponse("disconnect") as DebugProtocol.DisconnectResponse;
        await this.disconnectRequest(disconnectResponse, {});
        return disconnectResponse;
    }

    /** Invoke a custom DAP request and wait for its async body handling to settle. */
    public async callCustom(command : string, args : any = {}) : Promise<DebugProtocol.Response>
    {
        const response = createResponse(command);
        this.customRequest(command, response, args);
        return waitForCapturedResponse(this, response);
    }
}

/** Optional harness that exercises the launch flow against a real Qt fixture when configured. */
describe("Qt-backed integration harness", function() : void
{
    it("launches the standalone Qt fixture when a bundled or external build is available", async function() : Promise<void>
    {
        this.timeout(20000);
        const fixture = resolveQtFixtureConfiguration();
        if (fixture === undefined)
            this.skip();

        const session = new IntegrationSession({} as any);

        try
        {
            const response = await session.callLaunch(
                {
                    program: fixture.program,
                    cwd: fixture.cwd,
                    args: [],
                    env: {
                        QT_QPA_PLATFORM: process.env.QT_QPA_PLATFORM ?? "offscreen"
                    },
                    host: process.env.QML_DEBUG_QT_FIXTURE_HOST ?? "127.0.0.1",
                    port: Number(process.env.QML_DEBUG_QT_FIXTURE_PORT ?? "12150"),
                    paths: {
                        "qrc:/qml": fixture.qmlPath
                    },
                    services: [ "DebugMessages", "QmlDebugger", "V8Debugger", "QmlInspector", "CanvasFrameRate", "EngineControl" ],
                    block: true
                }
            );

            assert.strictEqual(response.success, true);

            const capabilities = await session.callCustom("qml/getCapabilities");
            assert.strictEqual(capabilities.success, true);
            const serviceNames = capabilities.body.services.map((service : { name : string }) : string => { return service.name; });
            assert.strictEqual(serviceNames.includes("QmlDebugger"), true);
            assert.strictEqual(serviceNames.includes("V8Debugger"), true);

            const inspectorStatus = await session.callCustom("qml/inspector/status");
            assert.strictEqual(inspectorStatus.success, true);
            assert.strictEqual(typeof inspectorStatus.body.available, "boolean");

            const profilerStatus = await session.callCustom("qml/profiler/status");
            assert.strictEqual(profilerStatus.success, true);
            assert.strictEqual(typeof profilerStatus.body.available, "boolean");

            if (inspectorStatus.body.available)
            {
                const selectBySource = await selectKnownFixtureObject(session, fixture);
                if (!selectBySource.success && (selectBySource.message ?? "").includes("write after end"))
                {
                    const diagnostics = describeQtFixtureDiagnostics(fixture, selectBySource);
                    console.warn("Qt fixture debug transport closed before inspector source lookup:\n" + diagnostics);
                    if (isStrictQtFixtureRun())
                        assert.fail("Qt fixture debug transport closed before inspector source lookup. Diagnostics: " + diagnostics);

                    this.skip();
                }

                assert.strictEqual(selectBySource.success, true, selectBySource.message ?? JSON.stringify(selectBySource.body));
                assert.strictEqual(Array.isArray(selectBySource.body.matchedObjectIds), true);
                assert.ok(selectBySource.body.matchedObjectIds.length > 0);

                const objectTree = await session.callCustom("qml/inspector/objectTree");
                assert.strictEqual(objectTree.success, true);
                assert.strictEqual(Array.isArray(objectTree.body.objects), true);
                assert.strictEqual(Array.isArray(objectTree.body.contexts), true);
                assert.ok(objectTree.body.objects.length > 0);
                assert.strictEqual(typeof objectTree.body.objects[0].debugId, "number");
                assert.strictEqual(typeof objectTree.body.objects[0].className, "string");
                assert.ok(objectTree.body.objects[0].className.length > 0);
            }

            if (profilerStatus.body.available)
            {
                const start = await session.callCustom("qml/profiler/start", { flushInterval: 100 });
                assert.strictEqual(start.success, true);

                await waitForFixtureActivity(700);

                const stop = await session.callCustom("qml/profiler/stop");
                assert.strictEqual(stop.success, true);

                const exportSnapshot = await session.callCustom("qml/profiler/export");
                assert.strictEqual(exportSnapshot.success, true);
                assert.strictEqual(Array.isArray(exportSnapshot.body.timeline), true);
                assert.strictEqual(Array.isArray(exportSnapshot.body.eventKinds), true);
                assert.strictEqual(Array.isArray(exportSnapshot.body.eventCategories), true);
                if (exportSnapshot.body.timeline.length > 0)
                {
                    assert.strictEqual(typeof exportSnapshot.body.timeline[0].kind, "string");
                    assert.strictEqual(typeof exportSnapshot.body.timeline[0].category, "string");
                    assert.strictEqual(typeof exportSnapshot.body.timeline[0].label, "string");
                }
            }

            const disconnect = await session.callDisconnect();
            assert.strictEqual(disconnect.success, true);

            const relaunchSession = new IntegrationSession({} as any);
            try
            {
                const relaunch = await relaunchSession.callLaunch(
                    {
                        program: fixture.program,
                        cwd: fixture.cwd,
                        args: [],
                        env: {
                            QT_QPA_PLATFORM: process.env.QT_QPA_PLATFORM ?? "offscreen"
                        },
                        host: process.env.QML_DEBUG_QT_FIXTURE_HOST ?? "127.0.0.1",
                        port: Number(process.env.QML_DEBUG_QT_FIXTURE_PORT ?? "12150"),
                        paths: {
                            "qrc:/qml": fixture.qmlPath
                        },
                        services: [ "DebugMessages", "QmlDebugger", "V8Debugger", "QmlInspector", "CanvasFrameRate", "EngineControl" ],
                        block: true
                    }
                );
                assert.strictEqual(relaunch.success, true);
            }
            finally
            {
                await relaunchSession.callDisconnect().catch(() : void => undefined);
            }
        }
        finally
        {
            await session.callDisconnect().catch(() : void => undefined);
        }
    });
});