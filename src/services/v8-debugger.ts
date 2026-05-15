import Log  from "@qml-debug/common/log";
import Packet from "@qml-debug/transport/packet";

import { QmlDebugSession } from "@qml-debug/adapter/debug-adapter";
import {
    QmlRequest,
    QmlResponse,
    isQmlVersionRequest,
    QmlVersionResponse,
    isQmlVersionResponse,
    QmlSetBreakpointArguments,
    isQmlSetBreakpointRequest,
    QmlSetBreakpointResponse,
    isQmlSetBreakpointResponse,
    QmlClearBreakpointArguments,
    isQmlClearBreakpointRequest,
    QmlClearBreakpointResponse,
    isClearSetBreakpointResponse,
    QmlSetExceptionBreakArguments,
    isQmlSetExceptionBreakRequest,
    QmlSetExceptionBreakResponse,
    isQmlSetExceptionBreakResponse,
    QmlBacktraceArguments,
    isQmlBacktraceRequest,
    QmlBacktraceResponse,
    isQmlBacktraceResponse,
    QmlFrameRequestArguments,
    isQmlFrameRequest,
    QmlFrameResponse,
    isQmlFrameResponse,
    QmlScopeRequestArguments,
    isQmlScopeRequest,
    isQmlScopeResponse,
    QmlScopeResponse,
    QmlLookupRequestArguments,
    isQmlLookupRequest,
    QmlLookupResponse,
    isQmlLookupResponse,
    QmlEvalutaRequestArguments,
    isQmlEvalutaRequest,
    QmlEvaluateResponse,
    isQmlEvaluateResponse,
    QmlContinueRequestArguments,
    isQmlContinueRequest,
    QmlContinueResponse,
    isQmlContinueResponse,
    isQmlEvent,
    isQmlMessage,
    isQmlRequest,
    isQmlResponse
} from "@qml-debug/protocol/qml-messages";

/** In-flight V8 request tracked until the runtime responds or times out. */
interface ServiceAwaitingRequest
{
    /** Sequence id assigned to the request. */
    seqId : number;
    /** Promise resolver for the matching response. */
    resolve(value? : QmlResponse<any>): void;
    /** Promise reject callback for transport or protocol failures. */
    reject(value : Error): void;
    /** Timeout guard for the request. */
    timeoutId : NodeJS.Timeout;
    /** Shape validator for the matching response. */
    responseCheckFunction(value : any): boolean;
    /** Whether unsuccessful responses should be rejected automatically. */
    autoReject : boolean;
}

/** Service wrapper around the legacy V8Debugger transport used by Qt. */
export default class ServiceV8Debugger
{
    /** Monotonic sequence id for outgoing requests. */
    private seqId = -1;
    /** Owning debug session used for transport access. */
    private session? : QmlDebugSession;
    /** Requests waiting for a response from the runtime. */
    private awaitingRequests : ServiceAwaitingRequest[] = [];
    /** Outstanding connect request used by the initial handshake. */
    private connectRequest?: ServiceAwaitingRequest;
    /** Request timeout in milliseconds. */
    private requestTimeOut = 600000;

    /** Remove one pending connect request and cancel its timeout guard. */
    private finishConnectRequest() : ServiceAwaitingRequest | undefined
    {
        if (this.connectRequest === undefined)
            return undefined;

        const current = this.connectRequest;
        clearTimeout(current.timeoutId);
        this.connectRequest = undefined;
        return current;
    }

    /** Reject the active transport-level connect request, if any. */
    private rejectConnectRequest(error : Error) : void
    {
        const current = this.finishConnectRequest();
        if (current !== undefined)
            current.reject(error);
    }

    /** Reject every pending request because the V8 transport is no longer usable. */
    private rejectAwaitingRequests(error : Error) : void
    {
        while (this.awaitingRequests.length > 0)
        {
            const current = this.awaitingRequests.shift()!;
            clearTimeout(current.timeoutId);
            current.reject(error);
        }
    }

    /** Decode incoming V8 packets and dispatch responses or events. */
    private packetReceived(packet : Packet)
    {
        Log.trace("ServiceV8Debugger.packetReceived", [ packet ]);

        const header = packet.readStringUTF8();
        if (header !== "V8DEBUG")
        {
            Log.error("V8Debugger: Packet with wrong header received.");
            return;
        }

        const operation = packet.readStringUTF8();

        if (operation === "v8message")
        {
            const message = packet.readJsonUTF8();

            if (!isQmlMessage(message))
                throw Error("Message format check failed. Sequence Number: " + message.seq);

            if (message.type === "response")
            {
                if (!isQmlResponse(message))
                    throw Error("Response base format check failed.");

                for (let i = 0; i < this.awaitingRequests.length; i++)
                {
                    const current = this.awaitingRequests[i];
                    if (current.seqId !== message.request_seq)
                        continue;

                    this.finishOrCancelRequest(current.seqId);

                    if (current.autoReject && !message.success)
                    {
                        current.reject(new Error("V8Debugger: Command failed. Sequence Number: " + message.request_seq + ", Command: " + message.command));
                        return;
                    }

                    if (message.success && !current.responseCheckFunction(message))
                    {
                        current.reject(new Error("Response format check failed. Sequence Number (Request Seq Number): " + message.seq + "(" + message.request_seq + ")" + ", Command: " + message.command));
                        return;
                    }

                    current.resolve(message);

                    return;
                }

                Log.error("V8Debugger: Packet with wrong sequence id received. Sequence Id: " + message.request_seq  + ", Operation: " + operation);
            }
            else if (message.type === "event")
            {
                if (!isQmlEvent(message))
                    throw Error("Event format check failed. Sequence Number: " + message.seq);

                this.session!.onEvent(message);
            }
        }
        else if (operation === "connect")
        {
            const connectRequest = this.finishConnectRequest();
            if (connectRequest === undefined)
                return;

            connectRequest.resolve();
        }
    }

    /** Allocate the next request sequence id. */
    private nextSeq() : number
    {
        this.seqId++;
        return this.seqId;
    }

    /** Send one V8 request over the transport and await a validated response. */
    private makeRequest<ArgumentType, ResponseType>(requestCommand : string, requestArgs : ArgumentType, requestCheckFunction : any, responseCheckFunctionParam : any, autoReject? : boolean) : Promise<ResponseType>
    {
        Log.trace("ServiceV8Debugger.makeRequest", [ requestCommand, requestArgs ]);

        if (autoReject === undefined)
            autoReject = true;

        return new Promise<any>(
            (resolveParam, rejectParam) =>
            {
                const packet = new Packet();
                packet.appendStringUTF8("V8DEBUG");
                packet.appendStringUTF8("v8request");
                const seq = this.nextSeq();

                const request : QmlRequest<ArgumentType> =
                {
                    type: "request",
                    command: requestCommand,
                    seq: seq,
                    arguments: requestArgs
                };

                if (!requestCheckFunction(request))
                    throw Error("Request format check failed. Command: " + requestCommand + ", Arguments: " + requestArgs);

                packet.appendJsonUTF8(request);

                const envelopPacket = new Packet();
                envelopPacket.appendStringUTF16("V8Debugger");
                envelopPacket.appendSubPacket(packet);

                const tId = setTimeout(
                    () =>
                    {
                        const current = this.finishOrCancelRequest(seq);
                        if (current !== undefined)
                            current.reject(new Error("V8Debugger: Request timed out. Sequence Id: " + seq));
                    },
                    this.requestTimeOut
                );

                this.awaitingRequests.push(
                    {
                        seqId: seq,
                        resolve: resolveParam,
                        reject: rejectParam,
                        timeoutId: tId,
                        responseCheckFunction: responseCheckFunctionParam,
                        autoReject: autoReject!
                    }
                );

                this.session!.packetManager!.writePacket(envelopPacket).catch((error) =>
                {
                    const current = this.finishOrCancelRequest(seq);
                    if (current !== undefined)
                        current.reject(error instanceof Error ? error : new Error(String(error)));
                });
            }
        );
    }

    /** Remove one in-flight request and cancel its timeout guard. */
    private finishOrCancelRequest(seqId : number) : ServiceAwaitingRequest | undefined
    {
        Log.trace("ServiceV8Debugger.cancelRequest", [ seqId ]);

        for (let i = 0; i < this.awaitingRequests.length; i++)
        {
            const current = this.awaitingRequests[i];
            if (current.seqId !== seqId)
                continue;

            clearTimeout(current.timeoutId);
            this.awaitingRequests.splice(i, 1);
            return current;
        }

        return undefined;
    }

    /** Request V8 capability information from the runtime. */
    public async requestVersion() : Promise<QmlVersionResponse>
    {
        Log.trace("ServiceV8Debugger.requestBacktrace", []);

        const response = await this.makeRequest<null, QmlVersionResponse>(
            "version",
            null,
            isQmlVersionRequest,
            isQmlVersionResponse
        );

        return response;
    }

    /** Install a source breakpoint in the runtime. */
    public async requestSetBreakpoint(filenameParam : string, lineParam : number) : Promise<QmlSetBreakpointResponse>
    {
        Log.trace("ServiceV8Debugger.requestSetBreakpoint", [ filenameParam, lineParam ]);

        const response = await this.makeRequest<QmlSetBreakpointArguments, QmlSetBreakpointResponse>(
            "setbreakpoint",
            {
                ignoreCount: 0,
                type: "scriptRegExp",
                target: filenameParam,
                line: lineParam,
                enabled: true
            },
            isQmlSetBreakpointRequest,
            isQmlSetBreakpointResponse
        );

        return response;
    }

    /** Remove a previously installed source breakpoint. */
    public async requestClearBreakpoint(idParam : number) : Promise<QmlClearBreakpointResponse>
    {
        Log.trace("ServiceV8Debugger.requestClearBreakpoint", [ idParam ]);

        const response = await this.makeRequest<QmlClearBreakpointArguments, QmlClearBreakpointResponse>(
            "clearbreakpoint",
            {
                breakpoint: idParam
            },
            isQmlClearBreakpointRequest,
            isClearSetBreakpointResponse
        );

        return response;
    }

    /** Configure exception-break mode in the runtime. */
    public async requestSetExceptionBreakpoint(typeParam : string, enabledParam : boolean) : Promise<QmlSetExceptionBreakResponse>
    {
        Log.trace("ServiceV8Debugger.requestSetExceptionBreakpoint", [ typeParam, enabledParam ]);

        const response = await this.makeRequest<QmlSetExceptionBreakArguments, QmlSetExceptionBreakResponse>(
            "setexceptionbreak",
            {
                type: typeParam,
                enabled: enabledParam
            },
            isQmlSetExceptionBreakRequest,
            isQmlSetExceptionBreakResponse
        );

        return response;
    }

    /** Request the current call stack from the runtime. */
    public async requestBacktrace() : Promise<QmlBacktraceResponse>
    {
        Log.trace("ServiceV8Debugger.requestBacktrace", []);

        const response = await this.makeRequest<QmlBacktraceArguments, QmlBacktraceResponse>(
            "backtrace",
            {

            },
            isQmlBacktraceRequest,
            isQmlBacktraceResponse
        );

        return response;
    }

    /** Request one stack frame and its scope references. */
    public async requestFrame(frameId : number) : Promise<QmlFrameResponse>
    {
        Log.trace("ServiceV8Debugger.requestFrame", [ frameId ]);

        const response = await this.makeRequest<QmlFrameRequestArguments, QmlFrameResponse>(
            "frame",
            {
                number: frameId
            },
            isQmlFrameRequest,
            isQmlFrameResponse
        );

        return response;
    }

    /** Request one concrete scope object. */
    public async requestScope(scopeId : number) : Promise<QmlScopeResponse>
    {
        Log.trace("ServiceV8Debugger.requestScope", [ scopeId ]);

        const response = await this.makeRequest<QmlScopeRequestArguments, QmlScopeResponse>(
            "scope",
            {
                number: scopeId
            },
            isQmlScopeRequest,
            isQmlScopeResponse,
        );

        return response;
    }

    /** Request object details for one or more runtime handles. */
    public async requestLookup(handlesParam : number[]) : Promise<QmlLookupResponse>
    {
        Log.trace("ServiceV8Debugger.requestLookup", [ handlesParam ]);

        const response = await this.makeRequest<QmlLookupRequestArguments, QmlLookupResponse>(
            "lookup",
            {
                handles: handlesParam
            },
            isQmlLookupRequest,
            isQmlLookupResponse
        );

        return response;
    }

    /** Evaluate an expression in the selected stack frame. */
    public async requestEvaluate(frameId : number, expressionParam : string) : Promise<QmlEvaluateResponse>
    {
        Log.trace("ServiceV8Debugger.requestLookup", [ frameId, expressionParam ]);

        const response = await this.makeRequest<QmlEvalutaRequestArguments, QmlEvaluateResponse>(
            "evaluate",
            {
                frame: frameId,
                expression: expressionParam
            },
            isQmlEvalutaRequest,
            isQmlEvaluateResponse,
            false
        );

        return response;
    }

    /** Continue execution, optionally with a stepping action. */
    public async requestContinue(stepAction? : "in" | "out" | "next", stepCount? : 1) : Promise<QmlContinueResponse>
    {
        Log.trace("ServiceV8Debugger.requestContinue", []);

        const result = await this.makeRequest<QmlContinueRequestArguments, QmlContinueResponse>(
            "continue",
            {
                stepaction: stepAction,
                stepcount: stepCount
            },
            isQmlContinueRequest,
            isQmlContinueResponse
        );

        return result;
    }

    /** Interrupt the running runtime when the service supports suspend. */
    public async requestPause() : Promise<QmlResponse<undefined>>
    {
        Log.trace("ServiceV8Debugger.requestPause", []);

        const result = await this.makeRequest<object, QmlResponse<undefined>>(
            "suspend",
            {},
            (value : any) : boolean => { return isQmlRequest(value) && value.command === "suspend"; },
            (value : any) : boolean => { return isQmlResponse(value) && value.command === "suspend"; }
        );

        return result;
    }


    /** Send the transport-level V8 connect packet used during handshake. */
    public connect() : Promise<void>
    {
        Log.trace("ServiceV8Debugger.connect", []);

        return new Promise<any>(
            (resolveParam, rejectParam) =>
            {
                const packet = new Packet();
                packet.appendStringUTF8("V8DEBUG");
                packet.appendStringUTF8("connect");
                packet.appendJsonUTF8({});

                const envelopePacket = new Packet();
                envelopePacket.appendStringUTF16("V8Debugger");
                envelopePacket.appendSubPacket(packet);

                const tId = setTimeout(
                    () =>
                    {
                        const current = this.finishConnectRequest();
                        if (current !== undefined)
                            current.reject(new Error("V8Debugger: Connect request timed out."));
                    },
                    this.requestTimeOut
                );

                this.connectRequest =
                {
                    seqId: -1,
                    resolve: resolveParam,
                    reject: rejectParam,
                    timeoutId: tId,
                    responseCheckFunction: (value : any) =>  { return true; },
                    autoReject: true
                };

                this.session!.packetManager!.writePacket(envelopePacket).catch((error) =>
                {
                    const current = this.finishConnectRequest();
                    if (current !== undefined)
                        current.reject(error instanceof Error ? error : new Error(String(error)));
                });
            }
        );
    }

    /** Send the transport-level V8 disconnect packet. */
    public async disconnect() : Promise<void>
    {
        await this.requestContinue().catch(() : void => undefined);

        const packet = new Packet();
        packet.appendStringUTF8("V8DEBUG");
        packet.appendStringUTF8("disconnect");
        packet.appendJsonUTF8({});

        const envelopePacket = new Packet();
        envelopePacket.appendStringUTF16("V8Debugger");
        envelopePacket.appendSubPacket(packet);

        await this.session!.packetManager!.writePacket(envelopePacket);
    }

    /** Perform the V8 connect handshake and log the negotiated version. */
    public async handshake() : Promise<void>
    {
        Log.trace("ServiceV8Debugger.handshake", []);

        await this.connect();

        const versionResponse = await this.requestVersion();
        Log.info("V8 Service Version: " + versionResponse.body.V8Version);
    }

    /** Reset transient service state before a connection starts. */
    public async initialize() : Promise<void>
    {
        Log.trace("ServiceV8Debugger.initialize", []);

        this.rejectConnectRequest(new Error("V8Debugger service reinitialized."));
        this.rejectAwaitingRequests(new Error("V8Debugger service reinitialized."));
        this.seqId = -1;
    }

    /** Clear in-flight request bookkeeping after a connection ends. */
    public async deinitialize() : Promise<void>
    {
        Log.trace("ServiceV8Debugger.deinitialize", []);

        this.rejectConnectRequest(new Error("V8Debugger service disconnected."));
        this.rejectAwaitingRequests(new Error("V8Debugger service disconnected."));
        this.seqId = -1;
    }

    /** Register the V8Debugger packet handler on the shared transport. */
    public constructor(session : QmlDebugSession)
    {
        Log.trace("ServiceV8Debugger.constructor", [ session ]);

        this.session = session;
        this.session.packetManager.registerTransportCloseHandler((error : Error) : void =>
        {
            this.rejectConnectRequest(new Error("V8Debugger transport closed. " + error.message));
            this.rejectAwaitingRequests(new Error("V8Debugger transport closed. " + error.message));
        });
        this.session.packetManager.registerHandler("V8Debugger",
            (header, packet) : boolean =>
            {
                const servicePacket = packet.readSubPacket();
                this.packetReceived(servicePacket);

                return true;
            }
        );
    }
}
