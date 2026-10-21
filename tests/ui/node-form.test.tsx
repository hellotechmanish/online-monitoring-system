import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NodeFormModal } from "@/components/nodes/node-form-modal";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const SITE = "b".repeat(24);
beforeEach(() => {
  toast.success.mockReset();
  toast.error.mockReset();
});

function renderModal(onSaved = vi.fn(), onOpenChange = vi.fn()) {
  render(<NodeFormModal open onOpenChange={onOpenChange} mode="create" siteId={SITE} siteLabel="SITE-001 — Building A" onSaved={onSaved} />);
  return { onSaved, onOpenChange };
}

describe("Add Node modal", () => {
  it("has Node ID, Node Name, Sensor Configuration and no IP address field", () => {
    renderModal();
    expect(screen.getByLabelText(/node id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/node name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add sensor configuration/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/ip/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Building A/)).toBeInTheDocument();
  });

  it("validates quantity > 0 client-side and does not submit", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    renderModal();
    await user.type(screen.getByLabelText(/node id/i), "1001");
    await user.type(screen.getByLabelText(/node name/i), "EQ");
    await user.click(screen.getByRole("button", { name: /add sensor configuration/i }));
    const qty = screen.getByLabelText(/quantity/i);
    await user.clear(qty);
    await user.type(qty, "0");
    await user.click(screen.getByRole("button", { name: /create node/i }));
    expect(await screen.findByText("Sensor quantity must be greater than zero")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("submits multiple sensor configurations with the Site from props, toasts and closes", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ node: { id: "n", nodeId: 1001 } }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    const { onSaved, onOpenChange } = renderModal();
    await user.type(screen.getByLabelText(/node id/i), "1001");
    await user.type(screen.getByLabelText(/node name/i), "EQ");
    await user.click(screen.getByRole("button", { name: /add sensor configuration/i }));
    await user.click(screen.getByRole("button", { name: /add sensor configuration/i }));
    const qtys = screen.getAllByLabelText(/quantity/i);
    await user.clear(qtys[0]);
    await user.type(qtys[0], "2");
    await user.type(screen.getAllByLabelText(/low threshold/i)[0], "0.01");
    await user.type(screen.getAllByLabelText(/high threshold/i)[0], "10");
    await user.click(screen.getByRole("button", { name: /create node/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Node created successfully"));
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({
      nodeId: 1001,
      nodeName: "EQ",
      siteId: SITE,
      sensors: [
        { sensorType: "RES", quantity: 2, thresholds: { low: 0.01, high: 10 } },
        { sensorType: "NER", quantity: 1, thresholds: { low: null, high: null } },
      ],
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("server error keeps the modal open with values preserved", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Node ID already exists" } }), { status: 409 })));
    const { onSaved, onOpenChange } = renderModal();
    await user.type(screen.getByLabelText(/node id/i), "1001");
    await user.type(screen.getByLabelText(/node name/i), "EQ");
    await user.click(screen.getByRole("button", { name: /create node/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Node ID already exists"));
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("Node ID already exists");
    expect(screen.getByLabelText(/node id/i)).toHaveValue("1001");
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
