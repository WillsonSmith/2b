import { Kbd } from "../../../primitives/Kbd.tsx";
import { SHORTCUTS } from "../constants.ts";

export function HelpSection() {
  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Help & shortcuts</h2>
      <table className="help-table">
        <tbody>
          {SHORTCUTS.map(({ key, desc }) => (
            <tr key={key} className="help-row">
              <td className="help-key"><Kbd>{key}</Kbd></td>
              <td className="help-desc">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
