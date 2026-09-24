import { SoundPackPicker } from "../effects/SoundPackPicker";
import "./effects-community.css";

/** Community: sound packs only (visual skins stay Pro). */
export function SkinsPage({
  t,
}: {
  t: (key: string, vars?: Record<string, string>) => string;
  theme?: string;
}) {
  return (
    <div className="effects-community skins-page">
      <div id="skins-visual" />
      <div id="skins-sound">
        <SoundPackPicker t={t} />
      </div>
    </div>
  );
}
