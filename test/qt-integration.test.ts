import assert = require("assert");
import { QmlDebugSession } from "@qml-debug/debug-adapter";
import { DebugProtocol } from "@vscode/debugprotocol";


/** Create a synthetic DAP response shell for direct request invocation. */
function createResponse(command : string) : DebugProtocol.Response
{
    return { type: "response", seq: 1, request_seq: 1, command: command, success: true } as DebugProtocol.Response;
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
}

/** Optional harness that exercises the launch flow against a real Qt fixture when configured. */
describe("Qt-backed integration harness", function() : void
{
    it("launches a real Qt fixture when the environment is configured", async function() : Promise<void>
    {
        const program = process.env.QML_DEBUG_QT_FIXTURE_PROGRAM;
        const cwd = process.env.QML_DEBUG_QT_FIXTURE_CWD;
        const qmlPath = process.env.QML_DEBUG_QT_FIXTURE_QML_PATH;

        if (program === undefined || cwd === undefined || qmlPath === undefined)
            this.skip();

        const session = new IntegrationSession({} as any);

        try
        {
            const response = await session.callLaunch(
                {
                    program: program,
                    cwd: cwd,
                    args: [],
                    host: process.env.QML_DEBUG_QT_FIXTURE_HOST ?? "127.0.0.1",
                    port: Number(process.env.QML_DEBUG_QT_FIXTURE_PORT ?? "12150"),
                    paths: {
                        "qrc:/qml": qmlPath
                    },
                    services: [ "DebugMessages", "QmlDebugger", "V8Debugger", "QmlInspector", "CanvasFrameRate", "EngineControl" ],
                    block: true
                }
            );

            assert.strictEqual(response.success, true);
        }
        finally
        {
            await session.callDisconnect().catch(() : void => undefined);
        }
    });
});