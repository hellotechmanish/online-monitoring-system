import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteDetailsCard } from "@/components/sites/site-details-card";
import type { SiteDTO } from "@/lib/types";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const site: SiteDTO = { id: "a".repeat(24), siteCode: "SITE-001", siteName: "Building A", location: "Greater Noida", description: "Room", status: "active" };

function mockFetch(resp: { status: number; body: unknown }) {
  const f = vi.fn(async () => new Response(JSON.stringify(resp.body), { status: resp.status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(() => {
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("SiteDetailsCard edit/save/cancel", () => {
  it("is read-only with only an Edit button initially", () => {
    render(<SiteDetailsCard site={site} canEdit onSaved={() => {}} />);
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/site name/i)).toHaveAttribute("readonly");
    expect(screen.getByLabelText(/record id/i)).toHaveAttribute("readonly");
  });

  it("hides Edit for users without permission", () => {
    render(<SiteDetailsCard site={site} canEdit={false} onSaved={() => {}} />);
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });

  it("saves, toasts success and returns to read-only", async () => {
    const user = userEvent.setup();
    const fetch = mockFetch({ status: 200, body: { site: { ...site, siteName: "Building A2" } } });
    const onSaved = vi.fn();
    render(<SiteDetailsCard site={site} canEdit onSaved={onSaved} />);
    await user.click(screen.getByRole("button", { name: /edit/i }));
    const name = screen.getByLabelText(/site name/i);
    expect(name).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText(/record id/i)).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    await user.clear(name);
    await user.type(name, "Building A2");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Site updated successfully"));
    expect(fetch).toHaveBeenCalledWith(`/api/sites/${site.id}`, expect.objectContaining({ method: "PATCH" }));
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).siteName).toBe("Building A2");
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ siteName: "Building A2" }));
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("on failure shows an error toast, keeps edits and stays in edit mode", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 409, body: { error: { message: "Site code already exists" } } });
    const onSaved = vi.fn();
    render(<SiteDetailsCard site={site} canEdit onSaved={onSaved} />);
    await user.click(screen.getByRole("button", { name: /edit/i }));
    const code = screen.getByLabelText(/site code/i);
    await user.clear(code);
    await user.type(code, "SITE-002");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Site code already exists"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/site code/i)).toHaveValue("SITE-002");
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("Cancel discards unsaved changes", async () => {
    const user = userEvent.setup();
    const fetch = mockFetch({ status: 200, body: {} });
    render(<SiteDetailsCard site={site} canEdit onSaved={() => {}} />);
    await user.click(screen.getByRole("button", { name: /edit/i }));
    await user.clear(screen.getByLabelText(/site name/i));
    await user.type(screen.getByLabelText(/site name/i), "Changed");
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByLabelText(/site name/i)).toHaveValue("Building A");
    expect(screen.getByLabelText(/site name/i)).toHaveAttribute("readonly");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates before submitting and prevents duplicate submissions", async () => {
    const user = userEvent.setup();
    let resolve!: (r: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetch);
    render(<SiteDetailsCard site={site} canEdit onSaved={() => {}} />);
    await user.click(screen.getByRole("button", { name: /edit/i }));
    await user.clear(screen.getByLabelText(/site name/i));
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText("Site name is required")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/site name/i), "Ok");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(new Response(JSON.stringify({ site: { ...site, siteName: "Ok" } }), { status: 200 }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});
