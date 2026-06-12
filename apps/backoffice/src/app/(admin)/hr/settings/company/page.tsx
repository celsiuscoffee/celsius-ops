"use client";

import { useEffect, useRef, useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import Image from "next/image";
import { Loader2, Save, Building2, MapPin, UserCheck, Banknote, FileText, PenLine, Upload, Trash2 } from "lucide-react";
import { toast } from "@celsius/ui";
import { SettingsNav } from "../_nav";

// One row in hr_company_settings holds the legal + statutory + bank +
// payslip-presentation config used across payroll PDFs, statutory submission
// files, and the EA / confirmation letters. Editable by OWNER/ADMIN only.
type CompanySettings = {
  id: string;
  company_name: string;
  ssm_number: string | null;
  registration_number: string | null;
  lhdn_e_number: string | null;
  lhdn_c_number: string | null;
  employer_epf_number: string | null;
  employer_socso_number: string | null;
  zakat_number: string | null;
  hrdf_number: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  phone: string | null;
  officer_name: string | null;
  officer_ic: string | null;
  officer_position: string | null;
  officer_email: string | null;
  bank_name: string | null;
  bank_account_holder: string | null;
  bank_account_number: string | null;
  bank_corporate_id: string | null;
  bank_client_batch_id: string | null;
  bank_version: string | null;
  auto_release_payslip: boolean | null;
  payslip_hide_bik: boolean | null;
  payslip_disclaimer_enabled: boolean | null;
  payslip_disclaimer_text: string | null;
  payslip_password_protect: boolean | null;
  confirmation_signature_path: string | null;
};

const STATES = [
  "Johor", "Kedah", "Kelantan", "Kuala Lumpur", "Labuan", "Melaka",
  "Negeri Sembilan", "Pahang", "Perak", "Perlis", "Penang", "Putrajaya",
  "Sabah", "Sarawak", "Selangor", "Terengganu",
];

export default function CompanySettingsPage() {
  const { data, mutate } = useFetch<{ settings: CompanySettings | null; signature_url: string | null }>("/api/hr/company-settings");
  const settings = data?.settings;
  const signatureUrl = data?.signature_url;

  const [form, setForm] = useState<CompanySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingSig, setUploadingSig] = useState(false);
  const sigInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (settings && !form) setForm(settings);
  }, [settings, form]);

  if (!settings) {
    return (
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <SettingsNav />
        <div className="rounded-lg border bg-muted/10 p-12 text-center">
          {data ? (
            <div className="text-sm text-amber-700">
              <p className="font-semibold">No company settings row exists.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                One row should be seeded on first install. Insert one with your company
                name to start, then edit it from this page.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!form) return null;

  const update = <K extends keyof CompanySettings>(k: K, v: CompanySettings[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const handleUploadSignature = async (file: File) => {
    if (file.type !== "image/png") {
      toast.error("Signature must be a PNG with transparent background");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Signature file too large (max 2 MB)");
      return;
    }
    setUploadingSig(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/hr/company-settings/signature", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Upload failed");
      } else {
        toast.success("Signature saved");
        mutate();
      }
    } finally {
      setUploadingSig(false);
      if (sigInputRef.current) sigInputRef.current.value = "";
    }
  };

  const handleClearSignature = async () => {
    setUploadingSig(true);
    try {
      const res = await fetch("/api/hr/company-settings/signature", { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Could not clear signature");
      } else {
        toast.success("Signature cleared");
        mutate();
      }
    } finally {
      setUploadingSig(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/hr/company-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Save failed");
      } else {
        toast.success("Company settings saved");
        mutate();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <SettingsNav />

      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Building2 className="h-6 w-6 text-terracotta" />
          Company Settings
        </h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        Drives payslip headers, EA Form, statutory submission files, bank giro
        files, and confirmation letters. Update once and every downstream
        document reflects the change.
      </p>

      {/* Identity & Registration */}
      <Section icon={<Building2 className="h-4 w-4" />} title="Identity & Registration">
        <Field label="Company Name *">
          <input value={form.company_name} onChange={(e) => update("company_name", e.target.value)} className="input" />
        </Field>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="SSM No.">
            <input value={form.ssm_number ?? ""} onChange={(e) => update("ssm_number", e.target.value)} className="input" placeholder="e.g. 202103025734" />
          </Field>
          <Field label="Registration No. (legacy)">
            <input value={form.registration_number ?? ""} onChange={(e) => update("registration_number", e.target.value)} className="input" placeholder="e.g. 1424785-A" />
          </Field>
          <Field label="LHDN Employer Tax No. (E)">
            <input value={form.lhdn_e_number ?? ""} onChange={(e) => update("lhdn_e_number", e.target.value)} className="input" placeholder="e.g. E9172972405" />
          </Field>
          <Field label="LHDN Company Tax No. (C)">
            <input value={form.lhdn_c_number ?? ""} onChange={(e) => update("lhdn_c_number", e.target.value)} className="input" placeholder="e.g. C26773249100" />
          </Field>
          <Field label="Employer EPF No.">
            <input value={form.employer_epf_number ?? ""} onChange={(e) => update("employer_epf_number", e.target.value)} className="input" />
          </Field>
          <Field label="Employer SOCSO No.">
            <input value={form.employer_socso_number ?? ""} onChange={(e) => update("employer_socso_number", e.target.value)} className="input" />
          </Field>
          <Field label="HRDF No.">
            <input value={form.hrdf_number ?? ""} onChange={(e) => update("hrdf_number", e.target.value)} className="input" />
          </Field>
          <Field label="Zakat No.">
            <input value={form.zakat_number ?? ""} onChange={(e) => update("zakat_number", e.target.value)} className="input" />
          </Field>
        </div>
      </Section>

      {/* Address & Contact */}
      <Section icon={<MapPin className="h-4 w-4" />} title="Address & Contact">
        <Field label="Address Line 1">
          <input value={form.address_line1 ?? ""} onChange={(e) => update("address_line1", e.target.value)} className="input" />
        </Field>
        <Field label="Address Line 2">
          <input value={form.address_line2 ?? ""} onChange={(e) => update("address_line2", e.target.value)} className="input" />
        </Field>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Postcode">
            <input value={form.postcode ?? ""} onChange={(e) => update("postcode", e.target.value)} className="input" />
          </Field>
          <Field label="City">
            <input value={form.city ?? ""} onChange={(e) => update("city", e.target.value)} className="input" />
          </Field>
          <Field label="State">
            <select value={form.state ?? ""} onChange={(e) => update("state", e.target.value)} className="input">
              <option value="">— Select —</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Country">
            <input value={form.country ?? "Malaysia"} onChange={(e) => update("country", e.target.value)} className="input" />
          </Field>
          <Field label="Company Phone">
            <input value={form.phone ?? ""} onChange={(e) => update("phone", e.target.value)} className="input" placeholder="e.g. 03-XXXX XXXX" />
          </Field>
        </div>
      </Section>

      {/* HR Officer / Signatory */}
      <Section icon={<UserCheck className="h-4 w-4" />} title="HR Officer & Signatory">
        <p className="mb-3 text-xs text-muted-foreground">
          Name printed as the issuing officer on EA Form, confirmation letters, and statutory submissions.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Officer Name">
            <input value={form.officer_name ?? ""} onChange={(e) => update("officer_name", e.target.value)} className="input" />
          </Field>
          <Field label="Officer IC">
            <input value={form.officer_ic ?? ""} onChange={(e) => update("officer_ic", e.target.value)} className="input" />
          </Field>
          <Field label="Position">
            <input value={form.officer_position ?? ""} onChange={(e) => update("officer_position", e.target.value)} className="input" placeholder="e.g. Chief Executive Officer" />
          </Field>
          <Field label="Email">
            <input type="email" value={form.officer_email ?? ""} onChange={(e) => update("officer_email", e.target.value)} className="input" />
          </Field>
        </div>
      </Section>

      {/* E-Signature for Confirmation Letters */}
      <Section icon={<PenLine className="h-4 w-4" />} title="Signature for Confirmation Letters">
        <p className="mb-3 text-xs text-muted-foreground">
          Upload a transparent PNG of the signatory&apos;s signature. The system will
          stamp it onto every confirmation letter and file the signed PDF into the
          employee&apos;s Documents vault — no print, scan, or re-upload needed.
          For best results, sign on white paper, photograph it, and remove the
          background (any free tool will do).
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div
            className="flex h-24 w-64 items-center justify-center rounded-lg border-2 border-dashed bg-muted/20 cursor-pointer hover:border-terracotta hover:bg-terracotta/5 transition-colors"
            onClick={() => !uploadingSig && sigInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add("border-terracotta", "bg-terracotta/10"); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove("border-terracotta", "bg-terracotta/10"); }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.classList.remove("border-terracotta", "bg-terracotta/10");
              const f = e.dataTransfer.files?.[0];
              if (f) handleUploadSignature(f);
            }}
          >
            {signatureUrl ? (
              <Image
                src={signatureUrl}
                alt="Saved signature"
                width={240}
                height={88}
                className="h-20 w-auto object-contain pointer-events-none"
                unoptimized
              />
            ) : (
              <span className="text-xs text-muted-foreground pointer-events-none">Drop PNG here, or click to browse</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              ref={sigInputRef}
              type="file"
              accept="image/png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUploadSignature(file);
              }}
            />
            <button
              type="button"
              onClick={() => sigInputRef.current?.click()}
              disabled={uploadingSig}
              className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs font-medium hover:bg-muted/40 disabled:opacity-50"
            >
              {uploadingSig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {form.confirmation_signature_path ? "Replace signature" : "Upload signature (PNG)"}
            </button>
            {form.confirmation_signature_path && (
              <button
                type="button"
                onClick={handleClearSignature}
                disabled={uploadingSig}
                className="flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* Bank File / Giro Config */}
      <Section icon={<Banknote className="h-4 w-4" />} title="Bank File / Giro Config">
        <p className="mb-3 text-xs text-muted-foreground">
          Used to generate Maybank M2u corporate batch files for salary disbursement. Fill these once;
          the payroll run pulls from here when you click &quot;Maybank M2u&quot;.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Bank Name">
            <input value={form.bank_name ?? ""} onChange={(e) => update("bank_name", e.target.value)} className="input" placeholder="e.g. Maybank" />
          </Field>
          <Field label="Account Holder">
            <input value={form.bank_account_holder ?? ""} onChange={(e) => update("bank_account_holder", e.target.value)} className="input" />
          </Field>
          <Field label="Account Number">
            <input value={form.bank_account_number ?? ""} onChange={(e) => update("bank_account_number", e.target.value)} className="input" />
          </Field>
          <Field label="Corporate ID">
            <input value={form.bank_corporate_id ?? ""} onChange={(e) => update("bank_corporate_id", e.target.value)} className="input" placeholder="Maybank2u Biz / m2e ID" />
          </Field>
          <Field label="Client Batch ID">
            <input value={form.bank_client_batch_id ?? ""} onChange={(e) => update("bank_client_batch_id", e.target.value)} className="input" />
          </Field>
          <Field label="File Version">
            <input value={form.bank_version ?? ""} onChange={(e) => update("bank_version", e.target.value)} className="input" placeholder="e.g. v3" />
          </Field>
        </div>
      </Section>

      {/* Payslip presentation */}
      <Section icon={<FileText className="h-4 w-4" />} title="Payslip Presentation">
        <div className="space-y-3">
          <Toggle
            label="Auto-release payslips on payroll confirmation"
            description="When OFF, HR has to manually release each cycle's payslips before staff can view them."
            checked={form.auto_release_payslip ?? true}
            onChange={(v) => update("auto_release_payslip", v)}
          />
          <Toggle
            label="Hide BIK (Benefits in Kind) lines on payslip"
            description="Display them on EA Form regardless; only affects monthly payslip rendering."
            checked={form.payslip_hide_bik ?? false}
            onChange={(v) => update("payslip_hide_bik", v)}
          />
          <Toggle
            label="Password-protect payslip PDFs"
            description="Each PDF will require the employee's IC last 6 digits as the open password."
            checked={form.payslip_password_protect ?? false}
            onChange={(v) => update("payslip_password_protect", v)}
          />
          <Toggle
            label="Show legal disclaimer on payslip"
            description="A footer note (e.g. 'This is a system-generated payslip and does not require a signature.')"
            checked={form.payslip_disclaimer_enabled ?? false}
            onChange={(v) => update("payslip_disclaimer_enabled", v)}
          />
          {form.payslip_disclaimer_enabled && (
            <Field label="Disclaimer text">
              <textarea
                rows={3}
                value={form.payslip_disclaimer_text ?? ""}
                onChange={(e) => update("payslip_disclaimer_text", e.target.value)}
                className="input"
                placeholder="This is a system-generated payslip and does not require a signature."
              />
            </Field>
          )}
        </div>
      </Section>

      <div className="sticky bottom-0 flex justify-end border-t bg-background py-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-terracotta px-6 py-2.5 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="mb-4 flex items-center gap-2 font-semibold">{icon} {title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label, description, checked, onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/30">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
    </label>
  );
}
