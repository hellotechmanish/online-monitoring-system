import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MultiSelect } from "@/components/ui/multi-select";

function Harness({ onChange }: { onChange: (v: string[]) => void }) {
  const [v, setV] = useState<string[]>(["RES_0"]);
  return <MultiSelect label="Sensors" options={["RES_0", "RES_1", "NER_0"].map((value) => ({ value }))} value={v} onChange={(x) => { setV(x); onChange(x); }} />;
}

describe("Sensor multi-select", () => {
  it("toggles multiple sensors with mouse and keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: /sensors: RES_0/i });
    await user.click(trigger);
    const list = await screen.findByRole("listbox", { name: "Sensors" });
    expect(list).toHaveAttribute("aria-multiselectable", "true");
    await user.click(screen.getByRole("option", { name: /RES_1/ }));
    expect(onChange).toHaveBeenLastCalledWith(["RES_0", "RES_1"]);
    screen.getByRole("option", { name: /NER_0/ }).focus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith(["RES_0", "RES_1", "NER_0"]);
    expect(screen.getByRole("option", { name: /RES_0/ })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("option", { name: /RES_0/ }));
    expect(onChange).toHaveBeenLastCalledWith(["RES_1", "NER_0"]);
  });
});
