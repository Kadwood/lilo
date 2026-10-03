import { useStore } from "zustand";
import { hoopViewStore, setHoopView } from "../state/hoopViewStore";
import { CalibrationDialog } from "./CalibrationDialog";
import { CustomHoopDialog } from "./CustomHoopDialog";
import { HoopPicker } from "./HoopPicker";

/** The hoop dialogs, opened from anywhere through `hoopViewStore` (top bar, panel, palette, shortcuts). */
export function HoopDialogs() {
  const picker = useStore(hoopViewStore, (s) => s.pickerOpen);
  const calibrating = useStore(hoopViewStore, (s) => s.calibrationOpen);
  const editor = useStore(hoopViewStore, (s) => s.customEditor);
  return (
    <>
      {picker && <HoopPicker onClose={() => setHoopView({ pickerOpen: false })} />}
      {editor && <CustomHoopDialog editingId={editor.id} onClose={() => setHoopView({ customEditor: null })} />}
      {calibrating && <CalibrationDialog onClose={() => setHoopView({ calibrationOpen: false })} />}
    </>
  );
}
