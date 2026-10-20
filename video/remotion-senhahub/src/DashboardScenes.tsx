import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const ASSET = (name: string) => staticFile(`assets/${name}`);
const NAVY = "#08174E";
const YELLOW = "#FCBD0F";

type DashboardConfig = {
  readonly number: string;
  readonly title: string;
  readonly description: string;
  readonly image: string;
};

const DASHBOARDS = {
  alerts: {
    number: "01 / 06",
    title: "Alertas que orientam decisões",
    description: "Comece identificando alertas, riscos e oportunidades que exigem ação imediata.",
    image: "dashboards/dashboard-alerts.png",
  },
  team: {
    number: "02 / 06",
    title: "Equipe alinhada, atendimento eficiente",
    description: "Com prioridades definidas, acompanhe equipe, produtividade e qualidade do atendimento.",
    image: "dashboards/dashboard-team.png",
  },
  channels: {
    number: "03 / 06",
    title: "Canais que aproximam clientes",
    description: "Equipe alinhada, acompanhe canais e descubra a jornada dos clientes.",
    image: "dashboards/dashboard-channels.png",
  },
  accessibility: {
    number: "04 / 06",
    title: "Inclusão em cada atendimento",
    description: "Garanta acessibilidade e acolhimento nos canais e atendimentos do SenhaHub.",
    image: "dashboards/dashboard-accessibility.png",
  },
  stores: {
    number: "05 / 06",
    title: "Operação conectada entre lojas",
    description: "Agora, compare lojas, setores, filas e tempos para localizar gargalos.",
    image: "dashboards/dashboard-stores.png",
  },
  executive: {
    number: "06 / 06",
    title: "Visão executiva para evoluir",
    description: "Por fim, consolide indicadores e priorize decisões para melhorar resultados.",
    image: "dashboards/dashboard-executive.png",
  },
} satisfies Record<string, DashboardConfig>;

const DashboardLogo: React.FC = () => (
  <div
    style={{
      position: "absolute",
      left: "0.55%",
      top: "0.4%",
      width: "14.1%",
      height: "8.9%",
      display: "grid",
      placeItems: "center",
      borderRadius: 10,
      background: "#FFFFFF",
      boxShadow: "0 5px 14px #07133D20",
      zIndex: 3,
    }}
  >
    <Img
      src={ASSET("brand/senhahub-cart-logo.png")}
      style={{ width: "96%", height: "96%", objectFit: "contain" }}
    />
  </div>
);

const ChannelCountCorrection: React.FC = () => (
  <div
    style={{
      position: "absolute",
      left: "78.35%",
      top: "51.55%",
      width: "7.55%",
      aspectRatio: "1 / 1",
      borderRadius: "50%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      background: "#FFFFFF",
      color: "#10234F",
      textAlign: "center",
      zIndex: 2,
    }}
  >
    <strong style={{ fontSize: 30, lineHeight: 1.05, letterSpacing: -0.7 }}>1.842</strong>
    <span style={{ marginTop: 5, fontSize: 16, lineHeight: 1.08 }}>senhas<br />emitidas</span>
  </div>
);

const AccessibilityWaitCorrection: React.FC = () => (
  <div
    style={{
      position: "absolute",
      left: "85.55%",
      top: "23.05%",
      width: "12.9%",
      height: "18.3%",
      padding: "1.1% 1.05%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      border: "1px solid #DBE3FA",
      borderRadius: 15,
      background: "linear-gradient(145deg, #F8FAFF 0%, #F0F3FF 100%)",
      color: NAVY,
      zIndex: 2,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          width: 34,
          height: 34,
          flexShrink: 0,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: "#E6EEFF",
          color: "#2461EC",
          fontSize: 27,
          fontWeight: 800,
        }}
      >
        ◷
      </span>
      <strong style={{ fontSize: 17, lineHeight: 1.15 }}>Tempo médio<br />acessível</strong>
    </div>
    <strong style={{ fontSize: 40, letterSpacing: -1.2, lineHeight: 1 }}>3 min</strong>
    <div style={{ color: "#139657", fontSize: 20, fontWeight: 800 }}>↓ -32%</div>
    <span style={{ color: "#77819B", fontSize: 14 }}>vs. dia anterior</span>
  </div>
);

const DashboardScene: React.FC<{ config: DashboardConfig }> = ({ config }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleOpacity = interpolate(
    frame,
    [0, 0.45 * fps, 2.15 * fps, 2.9 * fps],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.22, 1, 0.36, 1) },
  );
  const detailBlur = interpolate(frame, [0, 2.7 * fps, 3.25 * fps], [11, 2, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const detailBrightness = interpolate(frame, [0, 2.7 * fps, 3.25 * fps], [0.46, 0.8, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const imageScale = interpolate(frame, [0, 8 * fps], [1.025, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: "#07133D", overflow: "hidden", fontFamily: "Inter, Arial, sans-serif" }}>
      <Img
        src={ASSET(config.image)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "fill",
          scale: imageScale,
          filter: `blur(${detailBlur}px) brightness(${detailBrightness})`,
        }}
      />
      <DashboardLogo />
      {config.number === "03 / 06" && <ChannelCountCorrection />}
      {config.number === "04 / 06" && <AccessibilityWaitCorrection />}
      <AbsoluteFill style={{ opacity: titleOpacity, display: "grid", placeItems: "center", padding: 100, background: "#020A22A8" }}>
        <div
          style={{
            width: 1380,
            minHeight: 490,
            padding: "72px 86px 78px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            borderRadius: 30,
            border: "1px solid #FFFFFF32",
            background: "linear-gradient(125deg, #08174EF2 0%, #101F55EF 100%)",
            boxShadow: "0 35px 100px #0008",
            color: "#FFFFFF",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 31 }}>
            <span style={{ width: 48, height: 5, borderRadius: 5, background: YELLOW }} />
            <span style={{ color: YELLOW, fontSize: 23, fontWeight: 800, letterSpacing: 3 }}>DASHBOARD {config.number}</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 74, lineHeight: 1.08, letterSpacing: -2.2, fontWeight: 820 }}>{config.title}</h1>
          <p style={{ margin: "29px 0 0", maxWidth: 1200, color: "#E3E8FA", fontSize: 39, lineHeight: 1.33, fontWeight: 450 }}>
            {config.description}
          </p>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const DashboardAlerts: React.FC = () => <DashboardScene config={DASHBOARDS.alerts} />;
export const DashboardTeam: React.FC = () => <DashboardScene config={DASHBOARDS.team} />;
export const DashboardChannels: React.FC = () => <DashboardScene config={DASHBOARDS.channels} />;
export const DashboardAccessibility: React.FC = () => <DashboardScene config={DASHBOARDS.accessibility} />;
export const DashboardStores: React.FC = () => <DashboardScene config={DASHBOARDS.stores} />;
export const DashboardExecutive: React.FC = () => <DashboardScene config={DASHBOARDS.executive} />;
