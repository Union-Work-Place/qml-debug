import Log from "@qml-debug/log";
import Packet from "@qml-debug/packet";
import { profilerFeatureNamesFromMask, DEFAULT_PROFILER_FEATURE_MASK } from "@qml-debug/profiler-features";
import { QmlDebugSession } from "@qml-debug/debug-adapter";


interface ProfilerPacketSummary
{
    timestamp : string;
    size : number;
    kind : string;
    hexPreview : string;
}

export interface QmlProfilerTimelineEvent extends ProfilerPacketSummary
{
    decodedValue? : boolean | number | string | number[];
}

export interface QmlProfilerExport
{
    summary : QmlProfilerSnapshot;
    eventKinds : { kind : string; count : number }[];
    timeline : QmlProfilerTimelineEvent[];
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
    timelineEvents : QmlProfilerTimelineEvent[];
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
    private timelineEvents : QmlProfilerTimelineEvent[] = [];

    private tryDecodeUtf16String(rawPacket : Buffer) : string | undefined
    {
        if (rawPacket.length < 4 || (rawPacket.length - 4) % 2 !== 0)
            return undefined;

        const length = rawPacket.readUInt32BE(0);
        if (length === 0xFFFFFFFF || length + 4 !== rawPacket.length)
            return undefined;

        return new Packet(rawPacket).readStringUTF16();
    }

    private tryDecodeUtf8String(rawPacket : Buffer) : string | undefined
    {
        if (rawPacket.length < 4)
            return undefined;

        const length = rawPacket.readUInt32BE(0);
        if (length === 0xFFFFFFFF || length + 4 !== rawPacket.length)
            return undefined;

        return new Packet(rawPacket).readStringUTF8();
    }

    private decodeTimelineEvent(rawPacket : Buffer, timestamp : string) : QmlProfilerTimelineEvent
    {
        const hexPreview = rawPacket.toString("hex").slice(0, 128);

        if (rawPacket.length === 0)
            return { timestamp: timestamp, size: 0, kind: "empty", hexPreview: hexPreview };

        if (rawPacket.length === 1 && (rawPacket[0] === 0 || rawPacket[0] === 1))
            return {
                timestamp: timestamp,
                size: 1,
                kind: "boolean",
                hexPreview: hexPreview,
                decodedValue: rawPacket[0] === 1
            };

        const utf16String = this.tryDecodeUtf16String(rawPacket);
        if (utf16String !== undefined)
            return {
                timestamp: timestamp,
                size: rawPacket.length,
                kind: "utf16-string",
                hexPreview: hexPreview,
                decodedValue: utf16String
            };

        const utf8String = this.tryDecodeUtf8String(rawPacket);
        if (utf8String !== undefined)
            return {
                timestamp: timestamp,
                size: rawPacket.length,
                kind: "utf8-string",
                hexPreview: hexPreview,
                decodedValue: utf8String
            };

        if (rawPacket.length === 4)
            return {
                timestamp: timestamp,
                size: 4,
                kind: "int32",
                hexPreview: hexPreview,
                decodedValue: new Packet(rawPacket).readInt32BE()
            };

        if (rawPacket.length === 8)
            return {
                timestamp: timestamp,
                size: 8,
                kind: "uint64",
                hexPreview: hexPreview,
                decodedValue: Number(new Packet(rawPacket).readUInt64BE())
            };

        if (rawPacket.length % 4 === 0 && rawPacket.length <= 64)
        {
            const packet = new Packet(rawPacket);
            const values : number[] = [];
            while (!packet.readEOF())
                values.push(packet.readInt32BE());

            return {
                timestamp: timestamp,
                size: rawPacket.length,
                kind: "int32-array",
                hexPreview: hexPreview,
                decodedValue: values
            };
        }

        return {
            timestamp: timestamp,
            size: rawPacket.length,
            kind: "binary",
            hexPreview: hexPreview
        };
    }

    private packetReceived(packet : Packet) : void
    {
        Log.trace("ServiceQmlProfiler.packetReceived", [ packet ]);

        this.packetCount++;
        this.receivedBytes += packet.getSize();
        this.lastPacketTimestamp = new Date().toISOString();
        const timelineEvent = this.decodeTimelineEvent(packet.getData(), this.lastPacketTimestamp);
        this.recentPackets.push(
            {
                timestamp: timelineEvent.timestamp,
                size: timelineEvent.size,
                kind: timelineEvent.kind,
                hexPreview: timelineEvent.hexPreview
            }
        );
        this.timelineEvents.push(timelineEvent);
        if (this.recentPackets.length > 25)
            this.recentPackets.shift();
        if (this.timelineEvents.length > 200)
            this.timelineEvents.shift();
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
            recentPackets: this.recentPackets.map((value) => { return { ...value }; }),
            timelineEvents: this.timelineEvents.map((value) => { return { ...value }; })
        };
    }

    public exportSnapshot() : QmlProfilerExport
    {
        const eventKinds = new Map<string, number>();
        for (const current of this.timelineEvents)
            eventKinds.set(current.kind, (eventKinds.get(current.kind) ?? 0) + 1);

        return {
            summary: this.getSnapshot(),
            eventKinds: [ ...eventKinds.entries() ]
                .map((entry) => { return { kind: entry[0], count: entry[1] }; })
                .sort((left, right) : number => { return right.count - left.count || left.kind.localeCompare(right.kind); }),
            timeline: this.timelineEvents.map((value) => { return { ...value }; })
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
        this.timelineEvents = [];
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