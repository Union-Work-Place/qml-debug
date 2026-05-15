import { TerminatedEvent } from "@vscode/debugadapter";
import { QmlDebugSession } from "@qml-debug/debug-adapter";
import Log from "@qml-debug/log";
import Packet from "@qml-debug/packet";

import { Socket } from "net";
import PromiseSocket from "promise-socket";
import { BufferHex, BufferHexOptions } from "buffer-hex";
import { TerminalColor } from "terminal-styler";


type PacketHandlerCallback = (header : string, data : Packet) => boolean;
type TransportCloseHandler = (error : Error) => void;

/** Registered packet callback for a Qt debug service header. */
export interface PacketHandler
{
    /** Service header name, or `*` to receive every packet. */
    name : string;
    /** Callback that handles a packet and returns true when dispatch should stop. */
    callback : PacketHandlerCallback;
}

/** Owns the TCP transport and Qt debug packet framing/dispatch. */
export default class PacketManager
{
    /** Debug session that receives termination events when the socket closes. */
    private session? : QmlDebugSession;
    /** Raw Node socket used by promise-socket. */
    private nodeSocket : Socket | null = null;
    /** Promise wrapper around the active Node socket. */
    private socket : PromiseSocket<Socket> | null = null;
    /** Buffered bytes waiting for a complete Qt debug packet. */
    private receiveBuffer = Buffer.alloc(0);
    /** Packet handlers registered by individual Qt debug service wrappers. */
    private packetHandlers : PacketHandler[] = [];
    /** Callbacks notified when the transport closes or errors. */
    private transportCloseHandlers : TransportCloseHandler[] = [];

    /** Target debug server host. */
    public host = "localhost";
    /** Target debug server port. */
    public port = 10222;
    /** Enables raw packet logging when true. */
    public logging = false;

    /** Handle bytes received from the socket and pass them through the frame parser. */
    private onData(data : Buffer) : void
    {
        Log.trace("PacketManager.onData()", [ data ]);
        Log.debug(
            () =>
            {
                const options : BufferHexOptions =
                {
                    offsetStyle:
                    {
                        foregroundColor: TerminalColor.green
                    }
                };
                return "Raw Data Received:\n" + BufferHex.dump(data, undefined, undefined, options);
            }
        );
        this.receivePacket(data);
    }

    /** Notify the DAP session when the Qt debug server closes the connection. */
    private onClose() : void
    {
        Log.trace("PacketManager.onClose", []);

        this.notifyTransportClosed(new Error("Connection closed."));

        this.session?.sendEvent(new TerminatedEvent());

        Log.warning("Connection closed.");
    }

    /** Log socket-level transport errors. */
    private onError(err : any) : void
    {
        Log.trace("PacketManager.onError", [ err ]);

        const error = err instanceof Error ? err : new Error(String(err));
        this.notifyTransportClosed(error);

        Log.error("Socket Error - " + error);
    }

    /** Notify registered transport listeners that the socket can no longer carry requests. */
    private notifyTransportClosed(error : Error) : void
    {
        for (const current of this.transportCloseHandlers)
        {
            try
            {
                current(error);
            }
            catch (handlerError)
            {
                Log.error("PacketManager transport-close handler failed. " + handlerError);
            }
        }
    }

    /** Open the TCP connection to the Qt QML debug server. */
    public async connect() : Promise<void>
    {
        Log.trace("connect", []);

        this.nodeSocket = new Socket();
        this.socket = new PromiseSocket(this.nodeSocket);
        this.nodeSocket.on("data", (data : Buffer) => { this.onData(data); });
        this.nodeSocket?.on("close", () => { this.onClose(); });
        this.nodeSocket?.on("error", (err) => { this.onError(err); });

        Log.info("Connecting to " + this.host + ":" + this.port + "...");
        await this.socket.connect(this.port, this.host);
        Log.success("Connected.");
    }

    /** Close the TCP connection and release socket state. */
    public async disconnect() : Promise<void>
    {
        Log.trace("PacketManager.disconnect", []);

        if (this.socket === null)
            return;

        Log.info("Disconnecting from " + this.host + ":" + this.port + "...");

        try
        {
            await this.socket.end();
        }
        finally
        {
            this.notifyTransportClosed(new Error("Connection disconnected."));

            this.socket.destroy();
            this.socket = null;

            this.nodeSocket?.destroy();
            this.nodeSocket = null;
        }

        Log.success("Disconnected.");
    }

    /** Register a handler for a Qt debug service packet header. */
    public registerHandler(header : string, callback : PacketHandlerCallback) : void
    {
        Log.trace("PacketManager.registerHandler", [ header, callback ]);

        this.packetHandlers.push({ name: header, callback: callback });
    }

    /** Register a callback that runs when the transport closes or errors. */
    public registerTransportCloseHandler(callback : TransportCloseHandler) : void
    {
        Log.trace("PacketManager.registerTransportCloseHandler", [ callback ]);

        this.transportCloseHandlers.push(callback);
    }

    /** Dispatch a decoded packet to the first matching service handler. */
    private dispatchPacket(packet : Packet)
    {
        Log.trace("PacketManager.dispatchPacket", [ packet ]);

        const header = packet.readStringUTF16();

        for (const current of this.packetHandlers)
        {
            if (current.name !== header && current.name !== "*")
                continue;

            const result = current.callback(header, packet);
            if (!result)
                continue;

            break;
        }
    }

    /** Append received bytes, decode all complete length-prefixed packets, and buffer the remainder. */
    public receivePacket(buffer : Buffer) : void
    {
        Log.trace("PacketManager.receivePacket", [ buffer ]);

        this.receiveBuffer = Buffer.concat([ this.receiveBuffer, buffer ]);

        while (true)
        {
            let targetSize : number;
            if (this.receiveBuffer.length >= 4)
                targetSize = this.receiveBuffer.readUInt32LE();
            else
                targetSize = Number.MAX_SAFE_INTEGER;

            if (targetSize < 4)
                throw new Error("PacketManager::receivePacket: Invalid packet size " + targetSize + ".");

            if (this.receiveBuffer.length === targetSize)
            {
                this.dispatchPacket(new Packet(this.receiveBuffer, targetSize - 4, 4));
                this.receiveBuffer = Buffer.alloc(0);
            }
            else if (this.receiveBuffer.length > targetSize)
            {
                this.dispatchPacket(new Packet(this.receiveBuffer, targetSize - 4, 4));
                this.receiveBuffer = this.receiveBuffer.slice(targetSize, this.receiveBuffer.length);
            }
            else
            {
                break;
            }
        }
    }

    /** Write one packet using Qt's little-endian length-prefixed outer frame. */
    public async writePacket(packet : Packet) : Promise<void>
    {
        Log.trace("PacketManager.writePacket", [ packet ]);

        if (this.socket === null)
            throw new Error("PacketManager::writePacket: Uninitialized connection.");

        let buffer = Buffer.alloc(4);
        buffer.writeUInt32LE(packet.getSize() + 4);
        buffer = Buffer.concat([ buffer, packet.getData() ]);

        while (true)
        {
            const count = await this.socket.write(buffer);

            Log.debug(
                () =>
                {
                    const options : BufferHexOptions =
                    {
                        offsetStyle: {
                            foregroundColor: TerminalColor.red
                        }
                    };

                    return "Raw Data Transfered:\n" + BufferHex.dump(buffer, undefined, undefined, options);
                }
            );

            if (count === buffer.length)
                return;

            buffer = buffer.slice(count);
        }
    }

    /** Return a promise that resolves when the socket closes and rejects on socket error. */
    public async process() : Promise<void>
    {
        Log.trace("PacketManager.process", []);

        if (this.nodeSocket === null)
            throw new Error("PacketManager::process: Uninitialized connection.");

        return new Promise(
            (resolve, reject) =>
            {
                this.nodeSocket?.on("close",
                    () =>
                    {
                        this.onClose();
                        resolve();
                    }
                );

                this.nodeSocket?.on("error",
                    (err) =>
                    {
                        this.onError(err);
                        reject();
                    }
                );
            }
        );
    }

    /** Create a packet manager bound to one QML debug session. */
    public constructor(session : QmlDebugSession)
    {
        Log.trace("PacketManager.constructor", [ session ]);
        this.session = session;
    }
}
