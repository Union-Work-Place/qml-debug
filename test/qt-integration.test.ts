import assert = require("assert");
import { QmlDebugSession } from "@qml-debug/debug-adapter";
import { DebugProtocol } from "@vscode/debugprotocol";


function createResponse(command : string) : DebugProtocol.Response
{
    return { type: "response", seq: 1, request_seq: 1, command: command, success: true } as DebugProtocol.Response;
}

class IntegrationSession extends QmlDebugSession
{
    public readonly responses : DebugProtocol.Response[] = [];

    public sendResponse(responseParam : DebugProtocol.Response) : void
    {
        this.responses.push(responseParam);
    }

    public sendEvent(_event : DebugProtocol.Event) : void
    {
        return undefined;
    }

    protected sendErrorResponse(responseParam : DebugProtocol.Response, codeOrMessage : any, format? : string, variables? : any, dest? : any) : void
    {
        responseParam.success = false;
        responseParam.message = typeof codeOrMessage === "object" ? codeOrMessage.format : format;
        this.responses.push(responseParam);
    }

    public async callLaunch(args : any) : Promise<DebugProtocol.Response>
    {
        const launchResponse = createResponse("launch");
        await this.launchRequest(launchResponse as DebugProtocol.LaunchResponse, args);
        return launchResponse;
    }
}

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
    });
});