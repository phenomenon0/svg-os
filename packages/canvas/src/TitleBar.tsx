import { EditableLabel } from "./EditableLabel";
import { C, FONT, titleBarStyle } from "./theme";

export function TitleBar({ label, color, onChange, children }: {
  label: string;
  color: string;
  onChange: (v: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div style={titleBarStyle}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <EditableLabel value={label} onChange={onChange} />
      <span style={{ flex: 1 }} />
      {children}
    </div>
  );
}
