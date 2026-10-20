import React from "react";
import { Video } from "@remotion/media";
import {
  AbsoluteFill,
  Composition,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const media = (name: string) => staticFile(`assets/inclusion/${name}`);

// The customer journey ends at frame 1650 (55 s); dashboards begin immediately after.
const INSERT_AT = 1650;
const LIBRAS_FRAMES = 184; // 6.12 s at 30 fps; includes the entire 6.1167 s recording.
const CONVERSATION_FRAMES = 300;
const ADDED_FRAMES = LIBRAS_FRAMES + CONVERSATION_FRAMES;

type Highlight = {
  from: number;
  to: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};

const highlights: Highlight[] = [
  { from: 0, to: 72, x: 745, y: 419, width: 681, height: 64, color: "#F7A800" },
  { from: 72, to: 156, x: 744, y: 480, width: 688, height: 109, color: "#F7A800" },
  { from: 156, to: 222, x: 1031, y: 698, width: 748, height: 61, color: "#168D55" },
  { from: 222, to: 300, x: 1030, y: 758, width: 748, height: 111, color: "#168D55" },
];

const ConversationScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#F7F8FB" }}>
      <Img
        src={media("conversa-audio-original.png")}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
      {highlights.map((item, index) => {
        const opacity = interpolate(
          frame,
          [item.from, item.from + 10, item.to - 10, item.to],
          [0, 0.85, 0.85, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.inOut(Easing.ease),
          },
        );
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: item.x,
              top: item.y,
              width: item.width,
              height: item.height,
              borderRadius: 16,
              border: `3px solid ${item.color}`,
              boxShadow: `0 0 0 5px ${item.color}18`,
              opacity,
              pointerEvents: "none",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const LibrasScene: React.FC = () => (
  <AbsoluteFill style={{ background: "#F7F8FB", color: "#0C1948", fontFamily: "Inter, Arial, sans-serif" }}>
    <Img
      src={staticFile("assets/brand/senhahub-cart-logo.png")}
      style={{ position: "absolute", left: 74, top: 51, width: 235, height: 62, objectFit: "contain" }}
    />
    <div style={{ position: "absolute", right: 74, top: 59, display: "flex", alignItems: "center", gap: 18, color: "#657082", fontSize: 18, fontWeight: 800, letterSpacing: 2 }}>
      <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#FF7900" }} />
      JORNADA DO CLIENTE
      <span style={{ marginLeft: 3, padding: "12px 19px", border: "1px solid #D7DEEB", borderRadius: 28, color: "#0C1948", background: "#FFFFFF", letterSpacing: 0, fontSize: 17 }}>
        03 · Atendimento multimodal
      </span>
    </div>
    <div style={{ position: "absolute", left: 74, top: 417, width: 535 }}>
      <div style={{ color: "#FF7900", fontSize: 18, fontWeight: 800, letterSpacing: 4, marginBottom: 28 }}>
        SENHAHUB · MULTIMODAL
      </div>
      <h1 style={{ margin: 0, fontSize: 60, fontWeight: 800, lineHeight: 1.09, letterSpacing: -2.2 }}>
        Atendimento<br />em Libras
      </h1>
      <div style={{ marginTop: 32, width: 70, height: 6, borderRadius: 6, background: "#F5B900" }} />
      <p style={{ margin: "34px 0 0", color: "#697282", fontSize: 27, lineHeight: 1.44 }}>
        A comunicação em Libras faz parte do atendimento para todos.
      </p>
    </div>
    <Video
      src={media("libras-original.mov")}
      trimBefore={0}
      durationInFrames={LIBRAS_FRAMES}
      playbackRate={1}
      objectFit="contain"
      style={{ position: "absolute", left: 680, top: 248, width: 1168, height: 760 }}
    />
  </AbsoluteFill>
);

export const SenhaHubInclusionEdit: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "#F4F5F6" }}>
      <Sequence name="Vídeo-base · jornada do cliente" durationInFrames={INSERT_AT} premountFor={fps}>
        <Video
          src={media("base-v2.mp4")}
          trimBefore={0}
          durationInFrames={INSERT_AT}
          objectFit="fill"
          style={{ width: "100%", height: "100%" }}
        />
      </Sequence>
      <Sequence name="Inclusão · atendimento em Libras" from={INSERT_AT} durationInFrames={LIBRAS_FRAMES} premountFor={fps}>
        <LibrasScene />
      </Sequence>
      <Sequence name="Inclusão · áudio com transcrição" from={INSERT_AT + LIBRAS_FRAMES} durationInFrames={CONVERSATION_FRAMES} premountFor={fps}>
        <ConversationScene />
      </Sequence>
      <Sequence name="Vídeo-base · dashboards e conclusão" from={INSERT_AT + ADDED_FRAMES} durationInFrames={3240 - INSERT_AT} premountFor={fps}>
        <Video
          src={media("base-v2.mp4")}
          trimBefore={INSERT_AT}
          durationInFrames={3240 - INSERT_AT}
          objectFit="fill"
          style={{ width: "100%", height: "100%" }}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

export const InclusionEditComposition: React.FC = () => (
  <Composition
    id="SenhaHubInclusionEdit"
    component={SenhaHubInclusionEdit}
    durationInFrames={3240 + ADDED_FRAMES}
    fps={30}
    width={1920}
    height={1080}
  />
);
