import "./index.css";
import { Composition, Folder } from "remotion";
import { MyComposition } from "./Composition";
import { InclusionEditComposition } from "./InclusionEdit";
import {
  DashboardAccessibility,
  DashboardAlerts,
  DashboardChannels,
  DashboardExecutive,
  DashboardStores,
  DashboardTeam,
} from "./DashboardScenes";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      <InclusionEditComposition />
      <Folder name="Dashboards">
        <Composition id="Dashboard-Alerts" component={DashboardAlerts} durationInFrames={240} fps={30} width={1920} height={1080} />
        <Composition id="Dashboard-Team" component={DashboardTeam} durationInFrames={240} fps={30} width={1920} height={1080} />
        <Composition id="Dashboard-Channels" component={DashboardChannels} durationInFrames={240} fps={30} width={1920} height={1080} />
        <Composition id="Dashboard-Accessibility" component={DashboardAccessibility} durationInFrames={240} fps={30} width={1920} height={1080} />
        <Composition id="Dashboard-Stores" component={DashboardStores} durationInFrames={240} fps={30} width={1920} height={1080} />
        <Composition id="Dashboard-Executive" component={DashboardExecutive} durationInFrames={240} fps={30} width={1920} height={1080} />
      </Folder>
    </>
  );
};
