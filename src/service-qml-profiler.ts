import Log from "@qml-debug/log";
import Packet from "@qml-debug/packet";
import { profilerFeatureNamesFromMask, DEFAULT_PROFILER_FEATURE_MASK } from "@qml-debug/profiler-features";
import { QmlDebugSession } from "@qml-debug/debug-adapter";


interface ProfilerPacketSummary
{
    timestamp : string;
    size : number;
}

export interface QmlProfilerSnapshot
{
    recording : boolean;
    requestedFeatureMask : string;
    requestedFeatures : string[];
    flushInterval : number;
    packetCount : number;
    receivedBytes : number;
    lastPacketTimestamp? : string;
    recentPackets : ProfilerPacketSummary[];
}

export default class ServiceQmlProfiler
{
    private session? : QmlDebugSession;
    private recording = false;
    private requestedFeatureMask = DEFAULT_PROFILER_FEATURE_MASK;
    private flushInterval = 250;
    private packetCount = 0;
    private receivedBytes = 0;
    private lastPacketTimestamp? : string;
    private recentPackets : ProfilerPacketSummary[] = [];

    private packetReceived(packet : Packet) : void
    {
        Log.trace("ServiceQmlProfiler.packetReceived", [ packet ]);

        this.packetCount++;
        this.receivedBytes += packet.getSize();
        this.lastPacketTimestamp = new Date().toISOString();
        this.recentPackets.push({ timestamp: this.lastPacketTimestamp, size: packet.getSize() });
        if (this.recentPackets.length > 25)
            this.recentPackets.shift();
    }

    private async sendRecordingStatus() : Promise<void>
    {
        const packet = new Packet();
        packet.appendBoolean(this.recording);
        packet.appendInt32BE(-1);

        if (this.recording)
        {
            packet.appendUInt64BE(this.requestedFeatureMask);
            packet.appendUInt32BE(this.flushInterval);
            packet.appendBoolean(true);
        }

        const envelope = new Packet();
        envelope.appendStringUTF16("CanvasFrameRate");
        envelope.appendSubPacket(packet);

        await this.session!.packetManager.writePacket(envelope);
    }

    public getSnapshot() : QmlProfilerSnapshot
    {
        return {
            recording: this.recording,
            requestedFeatureMask: this.requestedFeatureMask.toString(),
            requestedFeatures: profilerFeatureNamesFromMask(this.requestedFeatureMask),
            flushInterval: this.flushInterval,
            packetCount: this.packetCount,
            receivedBytes: this.receivedBytes,
            lastPacketTimestamp: this.lastPacketTimestamp,
            recentPackets: this.recentPackets.map((value) => { return { ...value }; })
        };
    }

    public async startRecording(featureMask : bigint, flushInterval : number) : Promise<QmlProfilerSnapshot>
    {
        this.requestedFeatureMask = featureMask;
        this.flushInterval = flushInterval;
        this.recording = true;
        await this.sendRecordingStatus();
        return this.getSnapshot();
    }

    public async stopRecording() : Promise<QmlProfilerSnapshot>
    {
        this.recording = false;
        await this.sendRecordingStatus();
        return this.getSnapshot();
    }

    public clear() : QmlProfilerSnapshot
    {
        this.packetCount = 0;
        this.receivedBytes = 0;
        this.lastPacketTimestamp = undefined;
        this.recentPackets = [];
        return this.getSnapshot();
    }

    public async initialize() : Promise<void>
    {
        Log.trace("ServiceQmlProfiler.initialize", []);
        this.recording = false;
        this.requestedFeatureMask = DEFAULT_PROFILER_FEATURE_MASK;
        this.flushInterval = 250;
        this.clear();
    }

    public async deinitialize() : Promise<void>
    {
        Log.trace("ServiceQmlProfiler.deinitialize", []);
        this.recording = false;
        this.clear();
    }

    public constructor(session : QmlDebugSession)
    {
        Log.trace("ServiceQmlProfiler.constructor", [ session ]);

        this.session = session;
        this.session.packetManager.registerHandler("CanvasFrameRate",
            (header, packet) : boolean =>
            {
                const servicePacket = packet.readSubPacket();
                this.packetReceived(servicePacket);
                return true;
            }
        );
    }
}