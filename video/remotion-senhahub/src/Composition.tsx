import React from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

const DATA = {
  store: "Supermercado Pompeia",
  sector: "Açougue — Loja 2",
  counter: "Balcão 1",
  service: "Atendimento preferencial",
  category: "60 anos ou mais",
  current: "A005",
  ticket: "A006",
  tagline: "Sua vez, sem filas.",
};
const C = {
  orange: "#FF7200",
  yellow: "#FCBD0F",
  navy: "#02021E",
  ink: "#151526",
  paper: "#F4F5F6",
  white: "#FFFFFF",
  green: "#16823E",
  red: "#B92319",
  muted: "#676B79",
  line: "#D9DCE1",
};
const ASSET = (name: string) => staticFile(`assets/${name}`);
const W = 1920;
const H = 1080;

const baseText: React.CSSProperties = { color: C.navy, fontFamily: "Inter, Arial, sans-serif" };

const Brand: React.FC<{compact?: boolean; light?: boolean}> = ({compact = false, light = false}) => (
  <div style={{display: "flex", alignItems: "center", gap: 16}}>
    <Img src={ASSET("references/senhahub-mark.png")} style={{width: compact ? 54 : 72, height: compact ? 54 : 72, borderRadius: 13, objectFit: "contain", background: C.white}} />
    <div style={{display: "flex", flexDirection: "column", lineHeight: 1.05, color: light ? C.white : C.navy}}>
      <span style={{fontSize: compact ? 15 : 19, fontWeight: 600, opacity: 0.83}}>{DATA.store}</span>
      <strong style={{fontSize: compact ? 31 : 42, letterSpacing: -1.5, fontWeight: 850}}>Senha<span style={{color: light ? C.yellow : C.orange}}>Hub</span></strong>
    </div>
  </div>
);

const DotGrid: React.FC = () => <div style={{position: "absolute", right: 40, top: 60, width: 220, height: 140, opacity: 0.18, backgroundImage: `radial-gradient(${C.navy} 1.4px, transparent 1.4px)`, backgroundSize: "15px 15px"}} />;

const Header: React.FC<{step: string}> = ({step}) => (
  <div style={{position: "absolute", left: 66, right: 70, top: 46, display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 5}}>
    <Brand compact />
    <div style={{display: "flex", alignItems: "center", gap: 12, color: C.muted, fontSize: 17, fontWeight: 700, letterSpacing: 1.2}}>
      <span style={{width: 9, height: 9, borderRadius: 9, background: C.orange}} /> JORNADA DO CLIENTE
      <span style={{marginLeft: 17, border: `1px solid ${C.line}`, borderRadius: 999, padding: "10px 17px", color: C.navy}}>{step}</span>
    </div>
  </div>
);

const Slide: React.FC<{step: string; title: string; subtitle?: string; duration: number; children: React.ReactNode; accent?: string}> = ({step, title, subtitle, duration, children, accent = C.orange}) => {
  const f = useCurrentFrame();
  const opacity = interpolate(f, [0, 12, duration - 12, duration], [0, 1, 1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const y = interpolate(f, [0, 18], [20, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  return (
    <AbsoluteFill style={{background: C.paper, color: C.navy, opacity, fontFamily: "Inter, Arial, sans-serif", overflow: "hidden"}}>
      <DotGrid />
      <Header step={step} />
      <div style={{position: "absolute", top: 175, left: 74, right: 74, bottom: 60, display: "flex", gap: 54, alignItems: "center", transform: `translateY(${y}px)`}}>
        <div style={{width: 550, flexShrink: 0, paddingBottom: 26}}>
          <div style={{fontWeight: 800, fontSize: 16, letterSpacing: 3, color: accent, marginBottom: 18, textTransform: "uppercase"}}>SenhaHub · Pompeia</div>
          <h1 style={{fontSize: 54, lineHeight: 1.07, letterSpacing: -1.8, margin: 0, fontWeight: 820}}>{title}</h1>
          {subtitle && <p style={{fontSize: 25, lineHeight: 1.42, color: C.muted, margin: "22px 0 0", maxWidth: 510}}>{subtitle}</p>}
        </div>
        <div style={{flex: 1, minWidth: 0, height: "100%", display: "flex", alignItems: "center", justifyContent: "center"}}>{children}</div>
      </div>
    </AbsoluteFill>
  );
};

const AttachedImage: React.FC<{name: string}> = ({name}) => (
  <div style={{width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center"}}>
    <Img src={ASSET("attached/" + name)} style={{width: "100%", height: "100%", objectFit: "contain"}} />
  </div>
);

const NotificationImage: React.FC = () => (
  <div style={{height: "100%", aspectRatio: "1179 / 2556", maxWidth: "100%", position: "relative"}}>
    <Img src={ASSET("attached/imagem-8.png")} style={{width: "100%", height: "100%", objectFit: "contain"}} />
    <div style={{position: "absolute", left: "18.4%", top: "8.1%", width: "7.3%", height: "1.45%", borderRadius: 2, background: "#321805", color: "#F2EAE1", fontSize: 10, lineHeight: 1.15, fontWeight: 500, textAlign: "center"}}>Você</div>
  </div>
);

const FlowGraphic: React.FC<{first: string; second: string}> = ({first, second}) => (
  <div style={{width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 18, color: C.navy}}>
    {[first, second].map((label, index) => (
      <React.Fragment key={label}>
        {index > 0 && <div style={{fontSize: 48, color: C.orange, fontWeight: 800}}>→</div>}
        <div style={{width: 330, minHeight: 180, background: C.white, border: "1px solid " + C.line, borderTop: "7px solid " + (index ? C.yellow : C.orange), borderRadius: 18, padding: "28px 24px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 13, boxShadow: "0 18px 42px #11122212"}}>
          <span style={{fontSize: 15, fontWeight: 800, letterSpacing: 2, color: C.muted}}>ETAPA {index + 1}</span>
          <strong style={{fontSize: 27, lineHeight: 1.2}}>{label}</strong>
        </div>
      </React.Fragment>
    ))}
  </div>
);

const SceneOne: React.FC<{duration: number}> = ({duration}) => <Slide step="02 · Tipo de atendimento" title="Escolha como deseja ser atendido" subtitle="No totem, selecione uma opção. Nesta demonstração, seguimos pelo atendimento preferencial." duration={duration}><AttachedImage name="Imagem-1.png" /></Slide>;
const SceneTwo: React.FC<{duration: number}> = ({duration}) => <Slide step="03 · Categoria" title="Selecione a categoria" subtitle="A tela apresenta as opções preferenciais. Para este exemplo, escolhemos 60 anos ou mais." duration={duration}><AttachedImage name="imagem-2.png" /></Slide>;
const SceneThree: React.FC<{duration: number}> = ({duration}) => <Slide step="04 · Setor e emissão" title="Escolha o setor" subtitle="Selecione Açougue — Loja 2 e toque em “Emitir senha”. O totem encaminha a solicitação para impressão." duration={duration}><FlowGraphic first="Açougue — Loja 2" second="Emitir senha" /></Slide>;
const HardwareScene: React.FC<{duration: number}> = ({duration}) => <Slide step="05 · Emissão física" title="Sua senha é impressa" subtitle="A solicitação chega à impressora e o comprovante físico é emitido." duration={duration}><AttachedImage name="imagem-3.png" /></Slide>;
const TicketScene: React.FC<{duration: number}> = ({duration}) => <Slide step="06 · Cupom e QR Code" title="Leve o comprovante com você" subtitle="O QR Code impresso abre o acompanhamento da senha pelo celular." duration={duration}><AttachedImage name="imagem-4.png" /></Slide>;
const TrackingScene: React.FC<{duration: number}> = ({duration}) => <Slide step="07 · Acompanhamento" title="Acompanhe a fila em tempo real" subtitle="Veja a senha atual, a sua senha e o estado do atendimento. O SenhaHub avisa quando estiver próximo." duration={duration}><AttachedImage name="imagem-5.png" /></Slide>;
const TvQueueScene: React.FC<{duration: number}> = ({duration}) => <Slide step="08 · TV do setor" title="Acompanhe também pela TV" subtitle="A tela reúne as últimas chamadas, a senha atual e os conteúdos informativos da loja." duration={duration}><AttachedImage name="imagem-6.png" /></Slide>;
const TvCallScene: React.FC<{duration: number}> = ({duration}) => <Slide step="09 · Senha chamada" title="A chamada ganha destaque na TV" subtitle="Quando a senha é chamada, ela aparece em destaque e um bip curto chama a atenção." duration={duration} accent={C.red}><AttachedImage name="imagem-7.png" /></Slide>;
const NotificationScene: React.FC<{duration: number}> = ({duration}) => <Slide step="10 · Notificação" title="O aviso chega ao celular bloqueado" subtitle="A notificação aparece na tela bloqueada. A imagem representa a vibração do aparelho." duration={duration}><NotificationImage /></Slide>;
const ArrivalScene: React.FC<{duration: number}> = ({duration}) => <Slide step="11 · Chegada ao balcão" title="Avise que está a caminho" subtitle="Toque em “Estou a caminho” no acompanhamento. O colaborador recebe a confirmação da sua chegada." duration={duration}><FlowGraphic first="Estou a caminho" second="Chegada informada ao colaborador" /></Slide>;
const FinishScene: React.FC<{duration: number}> = ({duration}) => {
  const f = useCurrentFrame();
  const finished = f >= 95;
  return <Slide step="12 · Conclusão" title={finished ? "Atendimento concluído" : "Finalize quando o pedido terminar"} subtitle={finished ? "Atendimento concluído. Obrigado por usar o SenhaHub." : "Depois de concluir o pedido, toque em “Informar fim do pedido” para encerrar o atendimento."} duration={duration} accent={finished ? C.green : C.orange}><FlowGraphic first="Informar fim do pedido" second="Atendimento concluído" /></Slide>;
};

const BrandScene: React.FC<{duration: number}> = ({duration}) => {
  const f = useCurrentFrame();
  const opacity = interpolate(f, [0, 12, duration - 12, duration], [0, 1, 1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const scale = interpolate(f, [0, 32], [0.94, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  return <AbsoluteFill style={{background: C.paper, display: "grid", placeItems: "center", opacity, fontFamily: "Inter, Arial, sans-serif", overflow: "hidden"}}>
    <div style={{position: "absolute", inset: "0 0 auto", height: 20, background: C.orange}} />
    <div style={{...baseText, display: "flex", flexDirection: "column", alignItems: "center", transform: `scale(${scale})`}}>
      <Brand />
      <div style={{marginTop: 34, width: 520, height: 4, background: C.yellow, borderRadius: 4}} />
      <div style={{fontSize: 31, fontWeight: 700, marginTop: 26}}>{DATA.tagline}</div>
    </div>
  </AbsoluteFill>;
};

const OutroScene: React.FC<{duration: number}> = ({duration}) => {
  const f = useCurrentFrame();
  const opacity = interpolate(f, [0, 15, duration - 28, duration], [0, 1, 1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  return <AbsoluteFill style={{background: C.navy, display: "grid", placeItems: "center", opacity, fontFamily: "Inter, Arial, sans-serif"}}>
    <div style={{display: "flex", flexDirection: "column", alignItems: "center"}}><Brand light /><div style={{height: 4, width: 370, background: C.yellow, borderRadius: 3, marginTop: 32}} /><div style={{fontSize: 36, marginTop: 27, fontWeight: 750, color: C.white}}>{DATA.tagline}</div></div>
  </AbsoluteFill>;
};

export const SenhaHubJourney: React.FC = () => (
  <AbsoluteFill style={{background: C.paper}}>
    <Sequence from={0} durationInFrames={60}><BrandScene duration={60} /></Sequence>
    <Sequence from={60} durationInFrames={150}><SceneOne duration={150} /></Sequence>
    <Sequence from={210} durationInFrames={120}><SceneTwo duration={120} /></Sequence>
    <Sequence from={330} durationInFrames={120}><SceneThree duration={120} /></Sequence>
    <Sequence from={450} durationInFrames={90}><HardwareScene duration={90} /></Sequence>
    <Sequence from={540} durationInFrames={90}><TicketScene duration={90} /></Sequence>
    <Sequence from={630} durationInFrames={210}><TrackingScene duration={210} /></Sequence>
    <Sequence from={840} durationInFrames={180}><TvQueueScene duration={180} /></Sequence>
    <Sequence from={1020} durationInFrames={120}><TvCallScene duration={120} /></Sequence>
    <Sequence from={1140} durationInFrames={150}><NotificationScene duration={150} /></Sequence>
    <Sequence from={1290} durationInFrames={150}><ArrivalScene duration={150} /></Sequence>
    <Sequence from={1440} durationInFrames={210}><FinishScene duration={210} /></Sequence>
    <Sequence from={1650} durationInFrames={150}><OutroScene duration={150} /></Sequence>
    <Sequence from={1034} durationInFrames={28}><Audio src={ASSET("tv-beep.wav")} volume={0.32} /></Sequence>
  </AbsoluteFill>
);

export const MyComposition = () => (
  <Composition id="SenhaHubJourney" component={SenhaHubJourney} durationInFrames={1800} fps={30} width={W} height={H} />
);
