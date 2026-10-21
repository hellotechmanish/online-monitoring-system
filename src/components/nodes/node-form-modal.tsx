"use client";

import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm, type Control, type UseFormRegister, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/client-api";
import { nodeCreateSchema } from "@/lib/validation";
import { SENSOR_TYPES, SENSOR_TYPE_LABELS, type SensorType } from "@/lib/protocol/sensors";
import type { NodeDTO, SiteDTO } from "@/lib/types";

/*
 * Form field names deliberately differ from the API names: an <input name="nodeName"> or id="nodeName"
 * inside a <form> clobbers the DOM property `form.nodeName` (likewise `id`, `name`),
 * which breaks libraries that read it. Values are mapped back to API fields on submit.
 */
const formSchema = z.object({
  node_id: nodeCreateSchema.shape.nodeId,
  node_name: nodeCreateSchema.shape.nodeName,
  site_ref: nodeCreateSchema.shape.siteId,
  sensors: nodeCreateSchema.shape.sensors,
});
type FormIn = z.input<typeof formSchema>;
type FormOut = z.output<typeof formSchema>;

const numStr = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

function toFormValues(node: NodeDTO | null, siteId: string): FormIn {
  if (!node) return { node_id: "", node_name: "", site_ref: siteId, sensors: [] } as unknown as FormIn;
  return {
    node_id: String(node.nodeId),
    node_name: node.nodeName,
    site_ref: node.siteId,
    sensors: node.sensors.map((s) => ({
      sensorType: s.sensorType,
      quantity: String(s.quantity),
      thresholds: { low: numStr(s.thresholds.low), high: numStr(s.thresholds.high) },
      overrides: s.overrides.map((o) => ({ sensorId: o.sensorId, low: numStr(o.low), high: numStr(o.high) })),
    })),
  } as unknown as FormIn;
}

/**
 * Create or edit a Node.
 *  - create: the Site is fixed to `siteId` (e.g. the Site page) unless `sites` is provided for selection.
 *  - edit: Node ID is immutable (read-only).
 * No IP address field by design.
 */
export function NodeFormModal({
  open,
  onOpenChange,
  mode,
  node,
  siteId,
  siteLabel,
  sites,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "create" | "edit";
  node?: NodeDTO | null;
  /** Fixed Site for create-from-Site-page. */
  siteId?: string;
  siteLabel?: string;
  /** When provided, the user picks the Site from this list. */
  sites?: Pick<SiteDTO, "id" | "siteCode" | "siteName">[];
  onSaved: (node: NodeDTO) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const defaults = useMemo(() => toFormValues(node ?? null, siteId ?? node?.siteId ?? ""), [node, siteId]);
  const form = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(formSchema), defaultValues: defaults, mode: "onSubmit" });
  const { register, handleSubmit, control, reset, watch, formState } = form;
  const sensors = useFieldArray({ control, name: "sensors" });

  useEffect(() => {
    if (open) {
      reset(defaults);
      setServerError(null);
    }
  }, [open, defaults, reset]);

  const usedTypes = (watch("sensors") ?? []).map((s) => s?.sensorType as SensorType);
  const nextFreeType = SENSOR_TYPES.find((t) => t !== "GN" && !usedTypes.includes(t));

  const submitting = formState.isSubmitting;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      let saved: NodeDTO;
      if (mode === "create") {
        // When opened from a Site page the Site comes from props, never from a form field.
        const body = { nodeId: values.node_id, nodeName: values.node_name, siteId: !sites && siteId ? siteId : values.site_ref, sensors: values.sensors };
        const r = await api<{ node: NodeDTO }>("/api/nodes", { method: "POST", body });
        saved = r.node;
        toast.success("Node created successfully");
      } else {
        const body: Record<string, unknown> = { nodeName: values.node_name, sensors: values.sensors };
        if (sites && values.site_ref !== node!.siteId) body.siteId = values.site_ref;
        const r = await api<{ node: NodeDTO }>(`/api/nodes/${node!.id}`, { method: "PATCH", body });
        saved = r.node;
        toast.success("Node updated successfully");
      }
      onSaved(saved);
      onOpenChange(false);
    } catch (e) {
      const msg = errorMessage(e, mode === "create" ? "Unable to create Node" : "Unable to save changes");
      setServerError(msg);
      toast.error(msg);
    }
  });

  const errs = formState.errors;
  const sensorsRootError = (errs.sensors as { root?: { message?: string }; message?: string } | undefined)?.root?.message ??
    (errs.sensors as { message?: string } | undefined)?.message;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      preventClose={submitting}
      title={mode === "create" ? "Add Node" : `Edit Node ${node?.nodeId ?? ""}`}
      description={
        mode === "create"
          ? siteLabel
            ? <>The Node will be created in <strong className="text-foreground">{siteLabel}</strong>.</>
            : "Register a converter/Node and its configured sensors."
          : "Node ID cannot be changed. Historical readings are kept when the configuration changes."
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="node-form" loading={submitting}>
            {mode === "create" ? "Create Node" : "Save"}
          </Button>
        </>
      }
    >
      <form id="node-form" onSubmit={onSubmit} noValidate className="space-y-5">
        {serverError && (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {serverError}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Node ID" htmlFor="node-id" required error={errs.node_id?.message} hint={mode === "edit" ? "Immutable" : "Numeric device ID, e.g. 1001"}>
            <Input
              id="node-id"
              inputMode="numeric"
              readOnly={mode === "edit"}
              aria-invalid={!!errs.node_id || undefined}
              aria-describedby={errs.node_id ? "node-id-error" : undefined}
              {...register("node_id")}
            />
          </Field>
          <Field label="Node Name" htmlFor="node-name" required error={errs.node_name?.message}>
            <Input id="node-name" aria-invalid={!!errs.node_name || undefined} placeholder="e.g. EQ" {...register("node_name")} />
          </Field>
          {sites ? (
            <Field label="Site" htmlFor="node-site" required error={errs.site_ref?.message} className="sm:col-span-2">
              <Select id="node-site" aria-invalid={!!errs.site_ref || undefined} {...register("site_ref")}>
                <option value="">Select a Site…</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.siteCode} — {s.siteName}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <input type="hidden" {...register("site_ref")} />
          )}
        </div>

        <fieldset className="rounded-md border border-border">
          <legend className="ml-3 px-1 text-xs font-semibold uppercase tracking-wide text-subtle">Sensor Configuration</legend>
          <div className="space-y-3 p-3">
            {sensors.fields.length === 0 && (
              <p className="rounded bg-muted px-3 py-2 text-sm text-subtle">No sensor configurations yet. Add one for each sensor type on this Node.</p>
            )}
            {sensors.fields.map((f, i) => (
              <SensorRow
                key={f.id}
                index={i}
                control={control}
                register={register}
                errors={errs}
                usedTypes={usedTypes}
                onRemove={() => sensors.remove(i)}
              />
            ))}
            {sensorsRootError && <p role="alert" className="text-xs text-danger">{sensorsRootError}</p>}
            <Button
              variant="outline"
              size="sm"
              disabled={!nextFreeType}
              onClick={() =>
                sensors.append({ sensorType: nextFreeType!, quantity: "1", thresholds: { low: "", high: "" }, overrides: [] } as unknown as NonNullable<FormIn["sensors"]>[number])
              }
            >
              <Plus className="h-4 w-4" /> Add Sensor Configuration
            </Button>
            <p className="text-xs text-subtle">
              Quantity is configured capacity. Live channel IDs (e.g. RES_0, VMR_R) are discovered from device messages. Thresholds are optional
              configuration values, not certified safety limits.
            </p>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

function SensorRow({
  index,
  control,
  register,
  errors,
  usedTypes,
  onRemove,
}: {
  index: number;
  control: Control<FormIn, any>;
  register: UseFormRegister<FormIn>;
  errors: FieldErrors<FormIn>;
  usedTypes: SensorType[];
  onRemove: () => void;
}) {
  const overrides = useFieldArray({ control, name: `sensors.${index}.overrides` as const });
  const [showOverrides, setShowOverrides] = useState(overrides.fields.length > 0);
  const e = (errors.sensors as any)?.[index] as any;
  const p = `sensor-${index}`;
  const thrErr = e?.thresholds?.message ?? e?.thresholds?.root?.message ?? e?.thresholds?.low?.message ?? e?.thresholds?.high?.message;
  const current = usedTypes[index];
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <div className="grid gap-3 sm:grid-cols-[1.6fr_0.7fr_0.8fr_0.8fr_auto] sm:items-start">
        <Field label="Sensor Type" htmlFor={`${p}-type`} error={e?.sensorType?.message}>
          <Select id={`${p}-type`} {...register(`sensors.${index}.sensorType` as const)}>
            {SENSOR_TYPES.map((t) => (
              <option key={t} value={t} disabled={t !== current && usedTypes.includes(t)}>
                {SENSOR_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quantity" htmlFor={`${p}-qty`} error={e?.quantity?.message}>
          <Input id={`${p}-qty`} type="number" min={1} step={1} inputMode="numeric" aria-invalid={!!e?.quantity || undefined} {...register(`sensors.${index}.quantity` as const)} />
        </Field>
        <Field label="Low threshold" htmlFor={`${p}-low`}>
          <Input id={`${p}-low`} type="number" step="any" placeholder="—" {...register(`sensors.${index}.thresholds.low` as const)} />
        </Field>
        <Field label="High threshold" htmlFor={`${p}-high`}>
          <Input id={`${p}-high`} type="number" step="any" placeholder="—" {...register(`sensors.${index}.thresholds.high` as const)} />
        </Field>
        <div className="flex gap-1 sm:pt-5">
          <Button variant="ghost" size="icon" aria-label="Channel threshold overrides" aria-expanded={showOverrides} onClick={() => setShowOverrides((s) => !s)}>
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Remove ${current ?? "sensor"} configuration`} onClick={onRemove} className="text-danger hover:bg-danger/10">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {thrErr && <p role="alert" className="mt-1 text-xs text-danger">{thrErr}</p>}
      {showOverrides && (
        <div className="mt-3 rounded border border-dashed border-border p-2.5">
          <p className="mb-2 text-xs text-subtle">
            Channel-specific overrides take precedence over the type thresholds (e.g. <span className="font-mono">{current === "VMR" ? "VMR_R" : current === "TEMP" ? "Temp" : `${current}_0`}</span>).
          </p>
          {overrides.fields.map((of, j) => {
            const oe = e?.overrides?.[j];
            return (
              <div key={of.id} className="mb-2 grid grid-cols-[1fr_0.8fr_0.8fr_auto] items-start gap-2">
                <div>
                  <Input aria-label="Channel ID" placeholder="Channel ID" className="font-mono" {...register(`sensors.${index}.overrides.${j}.sensorId` as const)} />
                  {(oe?.sensorId?.message || oe?.message || oe?.root?.message) && <p role="alert" className="mt-1 text-xs text-danger">{oe?.sensorId?.message ?? oe?.message ?? oe?.root?.message}</p>}
                </div>
                <Input aria-label="Override low" type="number" step="any" placeholder="Low" {...register(`sensors.${index}.overrides.${j}.low` as const)} />
                <Input aria-label="Override high" type="number" step="any" placeholder="High" {...register(`sensors.${index}.overrides.${j}.high` as const)} />
                <Button variant="ghost" size="icon" aria-label="Remove override" onClick={() => overrides.remove(j)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          <Button variant="ghost" size="sm" onClick={() => overrides.append({ sensorId: "", low: "", high: "" } as never)}>
            <Plus className="h-3.5 w-3.5" /> Add channel override
          </Button>
        </div>
      )}
    </div>
  );
}
