import { getCurrentWindow } from "@tauri-apps/api/window";
import Overlay from "./overlay/Overlay";
import Panel from "./panel/Panel";
import PowerLayer from "./power/PowerLayer";
import GlossLayer from "./power/GlossLayer";

function App() {
  const label = getCurrentWindow().label;
  if (label === "overlay") return <Overlay />;
  if (label === "power") return <PowerLayer />;
  if (label === "gloss") return <GlossLayer />;
  return <Panel />;
}

export default App;
